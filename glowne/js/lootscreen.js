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
  let _carry   = null;      // { item, from, homeX, homeY, homeRot } — in hand
  let _sel     = null;      // the CLICKED item the detail panel and buttons act on
  let _rightWas = false;    // right button last frame, for an edge
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
    _carry = null; _sel = null; _done = false; _log = []; _rightWas = false;
    _flash = opts.intro || ''; _flashT = _flash ? 4 : 0;
  }

  function openHold(holdGrid, opts = {}) {
    _wreck = null; _hold = holdGrid; _opts = opts;
    _timed = false; _timer = 0;
    _carry = null; _sel = null; _done = false; _log = []; _rightWas = false;
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

    // Rotate the carried item (or the selected one) with R.
    if (Input.isPressed?.('KeyR')) _rotate();

    /* ── CLICK TO PICK UP, CLICK TO PUT DOWN (update48) ──────
     *
     * This screen used to work two ways at once and both of them were
     * wrong.
     *
     * Carrying was HOLD-THE-BUTTON: press on a crate, keep the button
     * down, release over a cell. On a full grid that is a long drag
     * with a heavy crate under the cursor, and letting go a pixel wide
     * of the mark sent it back where it came from.
     *
     * Selection was HOVER: whatever the mouse last passed over became
     * the selected crate. So you clicked the He2 at the top, walked
     * the cursor down to SELL, and sold whatever happened to lie under
     * the path. The player's report is exactly that: "I select
     * something at the top, move the mouse down or sideways, and it
     * selects the last thing instead of the one I need."
     *
     * ONE MODEL NOW, and the mouse only ever means what was clicked:
     *   left click on a crate  → it comes into the hand and is selected
     *   left click again       → it goes down where the cursor is
     *   right click / ESC      → it goes back where it came from
     * Passing the cursor over anything changes NOTHING.
     */
    const rightNow = !!Input.mouse.rightDown;
    const rightPressed = rightNow && !_rightWas;
    _rightWas = rightNow;

    if ((rightPressed || Input.isPressed?.('Escape')) && _carry) {
      _returnCarried();
      _say('Put it back');
      return null;
    }

    if (Input.mouse.leftPressed) {
      // Buttons win over the grid.
      for (const z of _zones) {
        if (Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) {
          Audio.sfx.uiClick?.();
          return _act(z.act, z.arg);
        }
      }
      if (_carry) _putDown(mx, my, CELL);
      else        _pickUp(mx, my);
    }

    /* The selection can still go stale WITHOUT the cursor moving: it
       was used up, sold, dumped or merged away. Only that clears it. */
    if (!_carry && _sel && !_hold.items.includes(_sel) &&
        !(_wreck && _wreck.items.includes(_sel))) {
      _sel = null;
    }

    return null;
  }

  /** Take the crate under the cursor into the hand. */
  function _pickUp(mx, my) {
    for (const which of ['wreck', 'hold']) {
      const c = _cellAt(which, mx, my);
      if (!c) continue;
      const it = c.grid.at(c.cx, c.cy);
      if (!it) continue;
      c.grid.remove(it);
      _carry = { item: it, from: c.grid,
                 homeX: it.x, homeY: it.y, homeRot: it.rot };
      _sel = it;
      Audio.sfx.uiClick?.();
      return true;
    }
    return false;
  }

  /**
   * Put the carried crate down at the cursor.
   *
   * IT NEVER GOES BACK BY ITSELF. A click on a spot it does not fit
   * leaves it in the hand and says why — under the old model a missed
   * drop threw the crate home and you started the whole drag again.
   */
  function _putDown(mx, my, CELL) {
    const it = _carry.item;

    // Dropped ON another container of the same kind? Pour it in.
    // Two half-empty medkits should become one, not fight for cells.
    for (const which of ['wreck', 'hold']) {
      const c = _cellAt(which, mx, my);
      if (!c) continue;
      const target = c.grid.at(c.cx, c.cy);
      if (!CargoGrid.canMerge(it, target)) continue;
      CargoGrid.merge(it, target);
      if (it.qty > 0) {
        _say(`Topped it up to ${target.qty} — ${it.qty} still in hand`);
      } else {
        _say(`Merged — ${target.qty} in one container now`);
        _carry = null;
        _sel = target;
      }
      return true;
    }

    for (const which of ['wreck', 'hold']) {
      const r = _gridRect(which);
      if (!r) continue;
      // Snap by the item's TOP-LEFT, taken from where the cursor is,
      // so a big crate does not jump under the mouse when you let go.
      const gx = Math.round((mx - CELL / 2 - r.x) / (CELL + GAP));
      const gy = Math.round((my - CELL / 2 - r.y) / (CELL + GAP));
      if (!Utils.pointInRect(mx, my, r.x - CELL, r.y - CELL,
                             r.w + CELL * 2, r.h + CELL * 2)) continue;
      if (!r.grid.fits(it, gx, gy)) continue;
      r.grid.place(it, gx, gy);
      _carry = null;
      Audio.sfx.uiClick?.();
      return true;
    }
    _say('It will not go there — right-click to put it back', false);
    return false;
  }

  /**
   * Whatever is in the hand goes back exactly where it was picked up.
   *
   * Returns FALSE if there is nowhere to put it — and then it stays in
   * the hand. Nothing here may ever end with an item belonging to no
   * grid and to no hand: that is precisely how cargo used to evaporate.
   */
  function _returnCarried() {
    if (!_carry) return true;
    const it = _carry.item;
    const rot = it.rot;
    it.rot = _carry.homeRot;
    if (_carry.from.place(it, _carry.homeX, _carry.homeY) || _carry.from.autoPlace(it)) {
      _carry = null;
      return true;
    }
    // A SPLIT half has no home cell to go back to — its parent is still
    // sitting in it. Try the other grid before giving up.
    const other = _carry.from === _hold ? _wreck : _hold;
    if (other && other.autoPlace(it)) { _carry = null; return true; }
    it.rot = rot;
    return false;
  }

  /**
   * The hand must be empty before a BUTTON touches a crate.
   *
   * USE, SELL, DUMP and SPLIT all reason about an item that is IN a
   * grid — `_hold.items.includes(it)` is the guard on half of them.
   * Under the old hold-to-drag model the buttons were unreachable
   * while carrying, so it never came up; now that a click frees the
   * mouse, a carried crate has to land first.
   */
  function _settle() {
    if (!_carry) return true;
    if (_returnCarried()) return true;
    _say('Put what you are carrying down first — nowhere to stow it', false);
    return false;
  }

  function _rotate() {
    const it = _carry?.item || _sel;
    if (!it) return;
    /* NO TURNING A CHIP (spec §6.2). The board sets noRotate, and the
       ban has to live here as well as in autoPlace — R is the other
       way a bar could be stood on end. */
    if (_hold?.noRotate && (_carry ? _carry.from === _hold : _hold.items.includes(it))) {
      _say('Chipa nie obraca się na planszy', false);
      return;
    }
    const owner = _carry ? null
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
    // Everything below reasons about a crate that is IN a grid.
    if (act !== 'rotate' && act !== 'done' && !_settle()) return null;
    switch (act) {
      case 'rotate':  _rotate(); return null;
      /* ── SPLIT A STACK (update48) ──────────────────────────
         A stack was all-or-nothing: sixteen He2 moved as sixteen, so
         you could not leave four behind for the base and take twelve,
         and you could not fill the one-cell gap a full hold leaves.
         SPLIT halves the pile into a second container of the same
         kind — click it again for four, again for two.

         The new half goes into the SAME grid if there is a cell for
         it and INTO THE HAND if there is not. It is never dropped:
         that is the whole rule this package is about. */
      case 'split': {
        const it = arg;
        if (!it || !it.isStack || it.qty < 2) return null;
        const owner = _hold.items.includes(it) ? _hold
                    : (_wreck?.items.includes(it) ? _wreck : null);
        if (!owner) return null;
        const take = Math.floor(it.qty / 2);
        const half = new CargoItem(it.defKey, it.meta);
        half.qty = take;
        half.damaged = it.damaged;
        /* The new container needs a REAL cell before the units leave
           the old one. Take the units out only once it has landed —
           split into nowhere and half the pile is gone. */
        const other = owner === _hold ? _wreck : _hold;
        if (owner.autoPlace(half)) {
          it.qty -= take;
          _say(`Split into ${it.qty} and ${take}`);
        } else if (other && other.autoPlace(half)) {
          it.qty -= take;
          _say(`Split ${take} off — no cell here, it went to the other hold`);
        } else {
          _say('No free cell to split into — make room first', false);
        }
        return null;
      }
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
      case 'tidy': {
        const moved = _hold.consolidate() + (_wreck?.consolidate() ?? 0);
        _say(moved ? `Repacked — ${moved} units merged into fewer containers`
                   : 'Nothing left to merge', !!moved);
        return null;
      }
      case 'unpack':  return _unpack(arg);
      case 'dump': {
        const it = arg;
        if (_hold.remove(it) || _wreck?.remove(it))
          _say(`${it.label} thrown out of the airlock — gone for good`, false);
        _sel = null;
        return null;
      }
      case 'sell': {
        // Opt-in: only screens that pass onSell get this button at all
        // (the warehouse), so wreck/pack/hold screens are untouched.
        const it = arg;
        if (!it || !_opts.onSell) return null;
        if (_hold.remove(it) || _wreck?.remove(it)) {
          const paid = _opts.onSell(it) ?? 0;
          _say(`Sold ${it.label} for ${paid} CC`, true);
        }
        _sel = null;
        return null;
      }
      /* THE LAST CRATES ARE SOLD OUT LOUD (update48).
         The docking screen passes sellRestOnDone, and the button then
         reads SELL THE REST — n CC instead of DONE. The base used to
         do exactly this silently, before the player ever saw the
         screen; the difference is that now the price is written on
         the button he presses. */
      case 'done': {
        if (_opts.sellRestOnDone && _opts.onSell && _hold.items.length) {
          let paid = 0, n = 0;
          for (const it of [..._hold.items]) {
            _hold.remove(it);
            paid += _opts.onSell(it) ?? 0;
            n++;
          }
          _sel = null;
          _say(`Sold ${n} crate${n > 1 ? 's' : ''} off the ship for ${paid} CC`);
        }
        return _finish();
      }
      default:        return null;
    }
  }

  function _unpack(it) {
    if (!it || !_hold.items.includes(it)) return null;
    if (it.damaged) { _say('Too damaged to open — sell it as scrap', false); return null; }
    const res = _opts.onUnpack?.(it);
    if (!res) return null;
    // A dose out of a medkit leaves the rest of the medkit: the handler
    // says whether the item is spent, we do not assume it.
    if (res.ok && res.consumed !== false && it.qty <= 0) { _hold.remove(it); _sel = null; }
    if (res.ok && res.consumed === true) { _hold.remove(it); _sel = null; }
    _say(res.message, res.ok);
    return null;
  }

  function _finish() {
    /* THE HAND IS NOT A CONTAINER. A crate still being carried belongs
       to no grid, and `onClose` is handed the grids — so closing with
       something in hand used to be a way to delete it, including when
       the wreck clock ran out on its own. It lands first, always. */
    _returnCarried();
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
    ctx.fillText(_opts.subtitle || 'click to pick up · click again to put down · right-click puts it back', 640, 84);

    if (_timed) _drawTimer(ctx);

    // ── grids ──
    if (_wreck) _drawGrid(ctx, 'wreck', _opts.leftLabel || 'DERELICT HOLD', '#ff9a6b');
    _drawGrid(ctx, 'hold', _opts.holdLabel || 'YOUR HOLD', '#4db8ff');

    // ── carried item follows the cursor ──
    if (_carry) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      _drawItem(ctx, _carry.item, mx - CELL / 2, my - CELL / 2, 0.85, true);
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
    if (_carry) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      const gx = Math.round((mx - CELL / 2 - r.x) / (CELL + GAP));
      const gy = Math.round((my - CELL / 2 - r.y) / (CELL + GAP));
      if (Utils.pointInRect(mx, my, r.x - CELL, r.y - CELL,
                            r.w + CELL * 2, r.h + CELL * 2)) {
        ghost = { gx, gy, ok: g.fits(_carry.item, gx, gy) };
      }
    }

    /* A CELL CAN BE OFF LIMITS (update49). On the CPU board the karma
       wall is one whole column and the rows above the captain's level
       are not his yet — both are drawn as walls rather than as empty
       cells, because "nothing fits here" and "nothing is here" are
       very different things to a player holding a chip. */
    const cap = _opts.board;
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        const px = r.x + x * (CELL + GAP), py = r.y + y * (CELL + GAP);
        const blocked = g.blockedAt?.(x, y);
        ctx.fillStyle = blocked ? 'rgba(40,26,20,0.9)' : 'rgba(13,17,32,0.85)';
        ctx.beginPath(); ctx.roundRect(px, py, CELL, CELL, 3); ctx.fill();
        ctx.strokeStyle = blocked ? '#4a3324' : '#1c2740'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(px, py, CELL, CELL, 3); ctx.stroke();
        if (!blocked) continue;
        // Hatching, so a wall never reads as a dark empty cell.
        ctx.save();
        ctx.strokeStyle = 'rgba(255,150,90,0.30)';
        for (let k = -CELL; k < CELL; k += 7) {
          ctx.beginPath();
          ctx.moveTo(px + Math.max(0, k), py + Math.max(0, -k));
          ctx.lineTo(px + Math.min(CELL, k + CELL), py + Math.min(CELL, CELL - k));
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    /* THE TWO SIDES, NAMED. Without this the wall is just a dark
       stripe and the player has to work out from failed placements
       which half takes which family. */
    if (cap && typeof Chips !== 'undefined' && g === _hold) {
      const wall = Chips.wallColumn(cap.karma ?? 50);
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      if (wall - 1 > 0) {
        ctx.fillStyle = Chips.FAMILIES.etos.col;
        ctx.fillText('ETOS ◄', r.x + (wall - 1) * (CELL + GAP) / 2, r.y + r.h + 14);
      }
      if (Chips.COLS - wall > 0) {
        ctx.fillStyle = Chips.FAMILIES.dominacja.col;
        const x0 = r.x + wall * (CELL + GAP);
        ctx.fillText('► DOMINACJA', (x0 + r.x + r.w) / 2, r.y + r.h + 14);
      }
      ctx.textAlign = 'left';

      /* WHY THE CROSSED-OUT ONES ARE CROSSED OUT, without having to
         touch them. And touching them is exactly what the player must
         NOT have to do: a chip goes inert precisely when there is no
         legal square left for it, so picking it up to read the panel
         would exile it to the shelf. The reason belongs on the board. */
      const dead = g.items.filter(it => Chips.isInert(cap, it));
      if (dead.length) {
        ctx.fillStyle = '#ff5566';
        ctx.font = '10px Share Tech Mono, monospace';
        ctx.fillText(`NIE DZIAŁA: ${dead.length} — ${dead[0].label}: `
                   + Chips.inertReason(cap, dead[0]), r.x, r.y + r.h + 30);
      }
    }

    if (ghost) {
      const m = _carry.item.mask;
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
      /* A CHIP THAT IS OUT OF FAVOUR (update49). It has not moved and
         it has not been taken away — it simply does nothing where the
         wall now stands, so it is drawn dimmed and crossed through.
         Deleting it, or shoving it into the hold, is exactly what the
         spec forbids: the player's own past decisions turned it off
         and his next ones can turn it back on. */
      const dead = !!cap && typeof Chips !== 'undefined'
                 && g === _hold && Chips.isInert(cap, it);
      _drawItem(ctx, it, r.x + it.x * (CELL + GAP), r.y + it.y * (CELL + GAP),
                dead ? 0.42 : 1, false, it === _sel);
      if (!dead) continue;
      ctx.save();
      ctx.strokeStyle = '#ff5566';
      ctx.lineWidth = 2;
      const x0 = r.x + it.x * (CELL + GAP), y0 = r.y + it.y * (CELL + GAP);
      const w0 = it.w * (CELL + GAP) - GAP, h0 = it.h * (CELL + GAP) - GAP;
      ctx.beginPath();
      ctx.moveTo(x0 + 3, y0 + 3); ctx.lineTo(x0 + w0 - 3, y0 + h0 - 3);
      ctx.moveTo(x0 + w0 - 3, y0 + 3); ctx.lineTo(x0 + 3, y0 + h0 - 3);
      ctx.stroke();
      ctx.restore();
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
    // How many are in there — the number IS the item, so it gets its own
    // corner rather than hiding in the detail panel.
    if (it.isStack) {
      const q = `×${it.qty}`;
      ctx.font = `${CELL < 34 ? 9 : 11}px Share Tech Mono, monospace`;
      ctx.textAlign = 'right';
      const qw = (ctx.measureText?.(q)?.width ?? 16) + 6;
      ctx.fillStyle = 'rgba(6,9,16,0.8)';
      ctx.beginPath();
      ctx.roundRect(px + w - qw - 2, py + h - 15, qw, 13, 3);
      ctx.fill();
      ctx.fillStyle = it.qty >= it.stackMax ? '#c8e8ff' : '#8fa8c0';
      ctx.fillText(q, px + w - 5, py + h - 5);
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
    const it = _carry?.item || _sel;
    if (!it) {
      ctx.fillStyle = '#3d4a63';
      ctx.font = '12px Share Tech Mono, monospace';
      // The old text still described dragging, which update48 removed.
      ctx.fillText('Kliknij skrzynię — bierzesz ją do ręki i zostaje zaznaczona. '
                 + 'Kliknij komórkę, żeby ją odłożyć; prawy klik odkłada na miejsce.',
                 x + 16, y + 30);
      ctx.fillText('R obraca, SPLIT dzieli stos na pół, a położenie pojemnika na drugim '
                 + 'tego samego typu przelewa je razem. THROW OVERBOARD niszczy na zawsze.',
                 x + 16, y + 48);
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
    const bits = [`${it.w}×${it.h}`];
    if (it.isStack) bits.push(`${it.qty} / ${it.stackMax} inside`);
    bits.push(`worth ~${it.value(port)} CC`);

    /* WHY IS IT CROSSED OUT? A dead chip that does not say what is
       wrong with it is a bug report waiting to happen — the player
       can see it is off and has no way to learn that his karma moved
       the wall under it. */
    if (_opts.board && typeof Chips !== 'undefined' && it.def.chipFamily) {
      const fam = Chips.FAMILIES[it.def.chipFamily];
      bits.push(fam ? fam.label : '');
      if (_hold.items.includes(it) && Chips.isInert(_opts.board, it)) {
        ctx.fillStyle = '#ff5566';
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.fillText('NIE DZIAŁA — ' + Chips.inertReason(_opts.board, it),
                     x + 380, y + 28);
        ctx.font = '11px Share Tech Mono, monospace';
      }
    }
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
    if (hot && enabled) Audio.hoverCue?.(`l:${act}:${x},${y}`);
    if (act && enabled) _zones.push({ x, y, w, h, act, arg });
  }

  function _drawButtons(ctx) {
    const y = 588;
    // The row starts further left than it used to: SPLIT joined it and
    // the old x=120 ran the last button under DONE.
    let x = 58;
    const sel = _carry?.item || _sel;

    _btn(ctx, x, y, 96, 34, 'ROTATE  R', { act: 'rotate', enabled: !!sel }); x += 104;

    // Merging by hand is putting one container down on another; TIDY does
    // the whole hold in one click.
    const canTidy = !!_hold.items.some(a => _hold.items.some(b => CargoGrid.canMerge(a, b)));
    _btn(ctx, x, y, 84, 34, 'TIDY',
         { act: 'tidy', col: '#4dd8ff', enabled: canTidy }); x += 92;

    // SPLIT is the other half of TIDY: one takes piles apart, the other
    // puts them together. Half off the top, so two clicks give quarters.
    const canSplit = !!sel && sel.isStack && sel.qty > 1;
    _btn(ctx, x, y, 116, 34, canSplit ? `SPLIT — ${Math.floor(sel.qty / 2)}` : 'SPLIT',
         { act: 'split', arg: sel, col: '#4dd8ff', enabled: canSplit }); x += 124;

    if (_wreck) {
      _btn(ctx, x, y, 120, 34, _opts.takeAllLabel || 'TAKE ALL',
           { act: 'takeAll', col: '#1aff8c' });
      x += 132;
    }

    /* Missiles feed the launchers straight from the rack, and since
       update39 He2 feeds the drive straight from the cell — there is
       nothing to "open" in either case. The button reads USE only when
       using does something: take a dose, unbox a gun, run a survey. */
    /* A crate IN THE HAND still counts as belonging to the grid it came
       out of: _act settles it before doing anything, so USE/SELL/DUMP
       would work — greying them out while you hold the very crate you
       clicked on is just confusing. */
    const inGrid = (g) => !!sel && (g?.items.includes(sel)
                                 || (_carry?.item === sel && _carry.from === g));
    const usable = sel && inGrid(_hold) && !sel.damaged
                 && ['heal', 'weapon', 'scan'].includes(sel.def.kind)
                 && (!sel.isStack || sel.qty > 0);
    const label = !sel ? 'USE'
                : sel.def.kind === 'heal'   ? 'USE A DOSE'
                : sel.def.kind === 'weapon' ? 'UNBOX & FIT'
                : sel.def.kind === 'scan'   ? 'RUN THE SURVEY'
                : 'USE';
    _btn(ctx, x, y, 150, 34, label,
         { act: 'unpack', arg: sel, col: '#ffd780', enabled: !!usable }); x += 162;

    // Only screens that pass onSell (the warehouse) get a SELL button —
    // a wreck or the ship's own hold has no shop to sell into.
    if (_opts.onSell) {
      const inHold = inGrid(_hold) || inGrid(_wreck);
      const price = sel ? sel.value(_opts.portType || 'general') : 0;
      _btn(ctx, x, y, 150, 34, sel ? `SELL — ${price} CC` : 'SELL',
           { act: 'sell', arg: sel, col: '#1aff8c', enabled: !!inHold }); x += 162;
    }

    _btn(ctx, x, y, 150, 34, 'THROW OVERBOARD',
         { act: 'dump', arg: sel, col: '#ff5566', enabled: !!sel });

    /* When the screen is the one that empties the ship, DONE has to
       say what it is about to do — and how much it pays. */
    const port2 = _opts.portType || 'general';
    const rest = (_opts.sellRestOnDone && _opts.onSell) ? _hold.items : [];
    const restCC = rest.reduce((n, it) => n + it.value(port2), 0);
    if (rest.length) {
      _btn(ctx, 1004, y, 236, 34, `SELL THE REST — ${restCC} CC`,
           { act: 'done', col: '#ffb020' });
    } else {
      _btn(ctx, 1040, y, 120, 34, _opts.doneLabel || 'DONE',
           { act: 'done', col: '#1aff8c' });
    }
  }

  return { openLoot, openHold, isOpen, update, draw,
           // exposed for tests — button positions shift as buttons are
           // added, so tests ask for them by name instead of guessing.
           _cellAt, _gridRect,
           _zoneFor: (act) => _zones.find(z => z.act === act) || null };
})();

if (typeof window !== 'undefined') window.LootScreen = LootScreen;
