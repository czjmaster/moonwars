/* ============================================================
   MOON WARS — game.js  (clean rewrite)
   ============================================================ */
'use strict';

const Game = (() => {

  // ── State ─────────────────────────────────────────────────
  let STATE        = 'menu';   // menu | map | combat | event | station | outcome
  let _prevTime    = 0;
  let _paused      = false;

  let _playerShip  = null;
  let _enemyShip   = null;
  let _sectorMap   = null;
  let _station     = null;
  let _event       = null;
  let _outcomeType = null;
  let _outcomeScrap= 0;
  let _outcomeTimer= 0;

  // GRAVEYARD used to be here. The memorial is a tab in the base now —
// THE HILL — where it sits beside the barracks it is the other half of,
// so the menu no longer needs its own door to a list of the dead.
const MENU_ITEMS = ['ENTER BASE','CONTINUE','OPTIONS'];
  let _fatal = '';   // set when a required module could not be loaded

  // ── Screen transition ────────────────────────────────────
  //  Hard cuts between menu / base / map / combat felt jarring; a short
  //  fade sells them as one continuous journey. Purely cosmetic: the
  //  state has ALREADY changed when the fade plays, so nothing can get
  //  stuck behind it.
  let _fadeT = 0;
  const FADE_TIME = 0.28;
  function _beginFade() { _fadeT = FADE_TIME; }
  function _drawFade(ctx) {
    if (_fadeT <= 0) return;
    const a = Math.min(1, _fadeT / FADE_TIME);
    ctx.fillStyle = `rgba(7,8,15,${a * 0.85})`;
    ctx.fillRect(0, 0, Renderer.getWidth(), Renderer.getHeight());
  }
  let _menuHover   = null;
  let _mapHover    = null;

  let _combatTimer = 0;
  let _combatFired = false;
  let _selectedWeapon = null;   // weapon awaiting a target room

  // FTL-style crew stations: SAVE snapshots current rooms,
  // RETURN sends everyone back. Session-only (not serialised).
  let _savedStations = null;    // Map crewId → roomId

  // Map screen has two switchable views: sector MAP or the SHIP
  let _mapView = 'map';   // 'map' | 'ship'

  // Boarding parties in transit (player → enemy, enemy → player)
  let _boardingParty = null;   // { crew:[], t, dur }
  let _enemyParty    = null;
  let _counterBoarded = false; // enemy already sent boarders this fight
  let _derelictOffered = false; // already offered the search/destroy choice this fight
  let _sosFightPending = false; // this fight was started to take a scavenger's He2
  /* THE CAPTAIN FLYING THIS CONTRACT (update43), or null. The very same
     object that sits in Base.captains() — never a copy of it. */
  let _captain = null;

  // Combat pending behind a negotiation dialog + nebula battle flag
  let _pendingCombat  = null;   // { difficulty, nebula }
  let _nebulaCombat   = false;  // both ships fight at −2 reactor power
  let _surrenderAsked = false;  // enemy already offered surrender this fight

  // ── Boot ──────────────────────────────────────────────────
  /** Modules that arrived AFTER the first release of index.html.
   *  If a player copies new js/ files but keeps an old index.html, the
   *  script tags are missing and the game dies the moment it needs
   *  them ("Enter Base" plays a click and nothing happens). Rather
   *  than depend on the player editing HTML, load them ourselves. */
  const LATE_MODULES = [
    { name: 'Base',       src: 'js/base.js' },
    { name: 'BaseScreen', src: 'js/basescreen.js' },
    { name: 'Chips',      src: 'js/chips.js' },
    { name: 'CargoGrid',  src: 'js/cargo.js' },
    { name: 'LootScreen', src: 'js/lootscreen.js' },
    { name: 'DockingGame', src: 'js/wreck.js' },
    { name: 'Captain',    src: 'js/captain.js' },
  ];

  function _moduleLoaded(name) {
    return typeof window !== 'undefined' && typeof window[name] !== 'undefined';
  }

  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.dataset.autoloaded = 'true';   // so it's distinguishable from index.html's own tags
      el.onload  = () => resolve(src);
      el.onerror = () => reject(new Error('could not load ' + src));
      document.head.appendChild(el);
    });
  }

  async function _ensureModules() {
    const missing = LATE_MODULES.filter(m => !_moduleLoaded(m.name));
    if (!missing.length) return true;
    console.warn('[Game] index.html is out of date — loading',
                 missing.map(m => m.src).join(', '), 'at runtime.');
    for (const m of missing) {
      try { await _loadScript(m.src); } catch (e) { console.error('[Game]', e.message); }
    }
    const stillMissing = LATE_MODULES.filter(m => !_moduleLoaded(m.name));
    if (stillMissing.length) {
      _fatal = 'Missing game files: ' + stillMissing.map(m => m.src).join(', ') +
               ' — re-extract the update over C:\\MoonWars\\ (index.html included).';
      return false;
    }
    return true;
  }

  async function init() {
    const canvas = document.getElementById('game-canvas');
    Renderer.init(canvas);
    Input.init(canvas);
    Audio.init();
    Save.load();
    // AFTER Save.load — the settings blob does not exist before it.
    // Until update40 the whole settings block in save.js was written,
    // persisted, and never read by a single line of game code.
    Audio.applySettings?.();

    await _ensureModules();

    Utils.setLoadingProgress(5, 'Generating sprites…');
    await Assets.init((p, m) => Utils.setLoadingProgress(10 + p * 75, m));
    Utils.setLoadingProgress(87, 'Animating crew…');
    Animation.init();
    Utils.setLoadingProgress(100, 'Ready.');
    await new Promise(r => setTimeout(r, 500));
    Utils.hideLoadingScreen();

    STATE = 'menu';
    requestAnimationFrame(_loop);
  }

  // ── Loop ──────────────────────────────────────────────────
  function _loop(ts) {
    requestAnimationFrame(_loop);
    const dt = Math.min((ts - _prevTime) / 1000, 0.05);
    _prevTime = ts;
    Input.beginFrame();
    if (Input.isPressed('KeyP')) _paused = !_paused;
    if (!_paused) _update(dt);
    _draw();
  }

  // ── Update ────────────────────────────────────────────────
  function _update(dt) {
    if (_fadeT > 0) _fadeT = Math.max(0, _fadeT - dt);
    UI.update(dt);
    Camera.update(dt);
    Particles.update(dt);

    if (STATE === 'menu')    _updateMenu(dt);
    if (STATE === 'options') _updateOptions(dt);
    if (STATE === 'base')    _updateBase(dt);
    if (STATE === 'map')     _updateMap(dt);
    if (STATE === 'combat')  _updateCombat(dt);
    if (STATE === 'outcome') _updateOutcome(dt);
    if (STATE === 'loot')    _updateLoot(dt);
    if (STATE === 'docking')  _updateDocking(dt);
    // The racks in the hold are the ammo. Whatever moved them — looting,
    // merging, jettisoning, a spoiled rack — the readout follows.
    if (STATE === 'map' || STATE === 'combat' || STATE === 'loot' ||
        STATE === 'station' || STATE === 'event') { _syncAmmo(); _syncFuel(); }
    if (STATE === 'station') _updateStation(dt);
  }

  // ── Draw ──────────────────────────────────────────────────
  function _draw() {
    const ctx = Renderer.getCtx();
    Renderer.clear();

    if (STATE === 'menu')    _drawMenu(ctx);
    if (STATE === 'options') _drawOptions(ctx);
    if (STATE === 'base')    BaseScreen.draw(ctx);
    if (STATE === 'map')     _drawMap(ctx);
    if (STATE === 'combat')  _drawCombat(ctx);
    if (STATE === 'event')   _drawEvent(ctx);
    if (STATE === 'station') _drawStation(ctx);
    if (STATE === 'outcome') _drawOutcome(ctx);
    if (STATE === 'loot')    LootScreen.draw(ctx);
    if (STATE === 'docking')  DockingGame.draw(ctx);

    // The loot screen is a full-screen modal — the HUD underneath it
    // would only fight the two holds for attention.
    if (STATE !== 'loot' && STATE !== 'docking') UI.draw(ctx, { playerShip: _playerShip });
    _drawFade(ctx);
    if (_paused) _drawPause(ctx);
    if (_fatal) _drawFatal(ctx);
  }

  // ── MENU ──────────────────────────────────────────────────
  function _updateMenu() {
    const mx = Input.mouse.x, my = Input.mouse.y;
    const W  = Renderer.getWidth(), H = Renderer.getHeight();
    const cx = W / 2;
    _menuHover = null;
    MENU_ITEMS.forEach((lbl, i) => {
      if (Utils.pointInRect(mx, my, cx-100, H/2-20+i*56, 200, 40)) _menuHover = i;
    });
    Audio.hoverCue?.(_menuHover === null ? null : `menu:${_menuHover}`);

    if (Input.mouse.leftPressed && _menuHover !== null) {
      Audio.resume();
      Audio.sfx.uiClick();
      // A thrown error here used to look like "the click did nothing"
      // (the sound had already played). Surface it instead.
      try {
        if (_menuHover === 0) _openBase();
        if (_menuHover === 1) _continueRun();
        if (_menuHover === 2) { STATE = 'options'; _beginFade(); }
      } catch (e) {
        console.error('[Game] menu action failed:', e);
        _fatal = String(e && e.message || e);
        UI.notify?.('Something broke: ' + _fatal, 'alert');
      }
    }
  }

  function _drawMenu(ctx) {
    Renderer.drawBackground(Date.now() * 0.008);
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    const cx = W / 2;

    // Logo
    ctx.save();
    ctx.shadowBlur = 30; ctx.shadowColor = '#1a8cff';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '64px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MOON WARS', cx, H/2 - 130);
    ctx.restore();

    ctx.fillStyle = '#2a4060';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TACTICAL SPACE SURVIVAL', cx, H/2 - 96);

    MENU_ITEMS.forEach((lbl, i) => {
      const bx = cx-100, by = H/2-20+i*56, bw = 200, bh = 40;
      const hover = _menuHover === i;
      ctx.fillStyle = hover ? 'rgba(26,140,255,0.3)' : 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();
      ctx.strokeStyle = hover ? '#4db8ff' : '#1e2d4a';
      ctx.lineWidth = hover ? 2 : 1; ctx.stroke();
      ctx.fillStyle = hover ? '#4db8ff' : '#c8d8f0';
      ctx.font = '15px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, cx, by + 26);
    });

    ctx.fillStyle = '#1a2a3a';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('MOON WARS v0.1', W-10, H-10);
  }

  /* ── OPTIONS ──────────────────────────────────────────────
   *
   * The whole settings subsystem already existed and was wired to
   * NOTHING: `Save.getSetting/setSetting`, `_defaultSettings()` with
   * three volume levels, and `Audio.setMasterVolume/SfxVolume/
   * MusicVolume` — every one of them written, persisted, and never
   * called by a single line of game code. A game with procedural music
   * and no way to turn it down is a game people play on mute.
   *
   * Three sliders and a mute toggle. Dragging is live (you hear what
   * you are setting) and the value is written to the save on release,
   * because Save.setSetting hits localStorage.
   */
  const OPT_ROWS = [
    { key: 'masterVolume', label: 'MASTER',  apply: v => Audio.setMasterVolume(v) },
    { key: 'sfxVolume',    label: 'EFFECTS', apply: v => Audio.setSfxVolume(v)    },
    { key: 'musicVolume',  label: 'MUSIC',   apply: v => Audio.setMusicVolume(v)  },
  ];
  const OPT_BAR = { x: 470, w: 340, h: 16, top: 250, gap: 62 };
  let _optDrag = null;      // key being dragged, or null
  let _optHover = null;

  function _optRowRect(i) {
    return { x: OPT_BAR.x, y: OPT_BAR.top + i * OPT_BAR.gap, w: OPT_BAR.w, h: OPT_BAR.h };
  }
  function _optBackRect() { return { x: 470, y: OPT_BAR.top + 3 * OPT_BAR.gap + 24, w: 150, h: 40 }; }
  function _optMuteRect() { return { x: 660, y: OPT_BAR.top + 3 * OPT_BAR.gap + 24, w: 150, h: 40 }; }

  /** Read a level, falling back to the shipped default. */
  function _optValue(key) {
    const v = Save.getSetting?.(key);
    if (typeof v === 'number') return Utils.clamp(v, 0, 1);
    return { masterVolume: 0.8, sfxVolume: 1.0, musicVolume: 0.35 }[key] ?? 0.8;
  }

  /** Mute is its own persisted flag, independent of the three levels. */
  function _optMuted() { return Save.getSetting?.('muted') === true; }

  function _updateOptions() {
    const mx = Input.mouse.x, my = Input.mouse.y;

    // ESC and a click on BACK both leave.
    if (Input.isPressed('Escape')) { STATE = 'menu'; _beginFade(); _optDrag = null; return; }

    _optHover = null;
    OPT_ROWS.forEach((row, i) => {
      const r = _optRowRect(i);
      // A generous grab band — a 16px bar is hard to hit exactly.
      if (Utils.pointInRect(mx, my, r.x - 8, r.y - 10, r.w + 16, r.h + 20)) _optHover = row.key;
    });
    const back = _optBackRect(), mute = _optMuteRect();
    if (Utils.pointInRect(mx, my, back.x, back.y, back.w, back.h)) _optHover = 'back';
    if (Utils.pointInRect(mx, my, mute.x, mute.y, mute.w, mute.h)) _optHover = 'mute';
    Audio.hoverCue?.(_optHover ? `opt:${_optHover}` : null);

    if (Input.mouse.leftPressed) {
      if (_optHover === 'back') {
        Audio.sfx.uiClick(); STATE = 'menu'; _beginFade(); return;
      }
      if (_optHover === 'mute') {
        Audio.sfx.uiClick();
        /* MUTE no longer overwrites masterVolume with 0 (update42).
           It used to, which meant the zero was saved, survived F5 —
           the game booted silent — and UNMUTE restored a guessed 0.8
           instead of the level the player had actually set. */
        const next = !_optMuted();
        Save.setSetting?.('muted', next);
        Audio.setMuted?.(next);
        return;
      }
      if (_optHover && OPT_ROWS.some(r => r.key === _optHover)) _optDrag = _optHover;
    }

    if (_optDrag) {
      if (!Input.mouse.leftDown) {
        // Persist ONCE, on release. The comment used to say this while
        // the drag branch below called setSetting — which writes
        // localStorage — on every frame (update42).
        Save.saveSettings?.();
        _optDrag = null;
      } else {
        const i = OPT_ROWS.findIndex(r => r.key === _optDrag);
        const r = _optRowRect(i);
        const v = Utils.clamp((mx - r.x) / r.w, 0, 1);
        // Live: you hear the level you are setting while you set it.
        (Save.setSettingLive ?? Save.setSetting)?.call(Save, _optDrag, v);
        OPT_ROWS[i].apply(v);
      }
    }
  }

  function _drawOptions(ctx) {
    Renderer.drawBackground(Date.now() * 0.006);
    const W = Renderer.getWidth(), H = Renderer.getHeight();

    ctx.save();
    ctx.fillStyle = 'rgba(5,7,14,0.78)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#4db8ff';
    ctx.font = '30px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('OPTIONS', W / 2, 170);
    ctx.fillStyle = '#5f7893';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('Drag a bar to set the level — you hear it as you drag.', W / 2, 196);

    OPT_ROWS.forEach((row, i) => {
      const r = _optRowRect(i);
      const v = _optValue(row.key);
      const hot = _optHover === row.key || _optDrag === row.key;

      ctx.textAlign = 'right';
      ctx.font = '13px Share Tech Mono, monospace';
      ctx.fillStyle = hot ? '#c8e8ff' : '#7a90a8';
      ctx.fillText(row.label, r.x - 20, r.y + 13);

      ctx.fillStyle = '#0a1018';
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 3); ctx.fill();
      ctx.fillStyle = v > 0 ? (hot ? '#4db8ff' : '#2f7fc4') : '#3d2430';
      ctx.beginPath(); ctx.roundRect(r.x, r.y, Math.max(3, r.w * v), r.h, 3); ctx.fill();
      ctx.strokeStyle = hot ? '#4db8ff' : '#1e2d4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w, r.h, 3); ctx.stroke();

      // Grip, so it reads as draggable rather than as a progress bar.
      const gx = r.x + r.w * v;
      ctx.fillStyle = hot ? '#c8e8ff' : '#9fdcff';
      ctx.fillRect(gx - 2, r.y - 5, 4, r.h + 10);

      ctx.textAlign = 'left';
      ctx.fillStyle = hot ? '#c8e8ff' : '#7a90a8';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.fillText(`${Math.round(v * 100)}%`, r.x + r.w + 16, r.y + 13);
    });

    const back = _optBackRect(), mute = _optMuteRect();
    const muted = _optMuted();
    [[back, 'BACK', '#4db8ff', 'back'],
     [mute, muted ? 'UNMUTE' : 'MUTE', muted ? '#ffd700' : '#ff7c20', 'mute']]
      .forEach(([r, label, col, id]) => {
        const hot = _optHover === id;
        ctx.fillStyle = hot ? 'rgba(26,140,255,0.18)' : 'rgba(13,17,32,0.92)';
        ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = hot ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 4); ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = '14px Orbitron, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, r.x + r.w / 2, r.y + 26);
      });

    ctx.fillStyle = '#2a4060';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ESC to go back', W / 2, OPT_BAR.top + 3 * OPT_BAR.gap + 86);
    ctx.restore();
  }

  // ── MAP ───────────────────────────────────────────────────
  function _updateMap(dt) {
    if (_playerShip) _playerShip.update(dt);

    // A gun won in the last fight is waiting to be stowed.
    if (_pendingLocker) {
      const key = _pendingLocker;
      _pendingLocker = null;
      _openWeaponLocker(key);
      return;
    }

    /* A BOSS CHIP THAT DID NOT FIT (update49). The spec is explicit
       that a guaranteed reward must not quietly disappear when the
       hold is full — so it waits here and opens the hold the moment
       the fight is over, exactly the way a won gun does. */
    if (_queuedChip) {
      const key = _queuedChip;
      _queuedChip = null;
      _openChipLocker(key);
      return;
    }

    // Fires (and other hazards) can finish a ship OUTSIDE combat —
    // don't wait for the next fight to notice we're dead.
    if (_playerShip) {
      const crewAlive = _playerCrewAliveCount() > 0;
      if (_playerShip.hull <= 0 || !crewAlive) {
        UI.notify(!crewAlive ? 'All crew lost…' : 'Hull breach — ship lost…', 'alert');
        _onLose();
        return;
      }
    }
    // TAB / M or the on-screen button flips between MAP and SHIP view
    const mx = Input.mouse.x, my = Input.mouse.y;
    const btn = _mapToggleRect();
    const btnClick = Input.mouse.leftPressed &&
      Utils.pointInRect(mx, my, btn.x, btn.y, btn.w, btn.h);
    const holdBtn = _holdBtnRect();
    const holdClick = Input.mouse.leftPressed &&
      Utils.pointInRect(mx, my, holdBtn.x, holdBtn.y, holdBtn.w, holdBtn.h);
    if (holdClick || Input.isPressed('KeyC')) { _openHold(); return; }

    if (btnClick || Input.isPressed('Tab') || Input.isPressed('KeyM')) {
      _mapView = _mapView === 'map' ? 'ship' : 'map';
      Audio.sfx.uiClick();
      if (btnClick) return;   // don't let the same click hit the new view
    }

    if (_mapView === 'ship') {
      // SHIP view: full crew management — rubber-band selection,
      // doors, power bar, medbay healing between jumps.
      _crewMouseUpdate();
      _mapHover = null;
      return;
    }

    // MAP view: the bottom power bar still works (buttons, pips)
    if (Input.mouse.leftPressed) _handlePowerBarClick();

    // Hover detection (panel is centered — the ship isn't drawn here)
    const ox = (Renderer.getWidth() - 700) / 2;
    const oy = (Renderer.getHeight() - 400) / 2;
    _mapHover = null;
    if (_sectorMap) {
      _sectorMap.nodes.forEach(node => {
        if (node.locked) return;
        const nx = node.x + ox, ny = node.y + oy;
        if (Utils.dist(mx, my, nx, ny) < 22) _mapHover = node.id;
      });
    }

    // Click detection
    if (Input.mouse.leftPressed && _mapHover) {
      _travelTo(_mapHover);
    }
  }

  function _retreatRect() {
    // Under the resources row — no longer covers the enemy readout
    return { x: Renderer.getWidth() / 2 - 65, y: 42, w: 130, h: 26 };
  }

  function _recallRect() {
    // Second row, directly under the retreat button
    return { x: Renderer.getWidth() / 2 - 65, y: 72, w: 130, h: 26 };
  }

  /** Fire the cloak. Called from the module icon in the power bar and
   *  from the C hotkey — one place, so both report the same reason. */
  function _activateCloak(cloak) {
    if (!cloak) return;
    if (cloak.activateCloak()) {
      UI.notify('CLOAK ENGAGED — evasion spike!', 'good');
      Audio.sfx.powerUp?.();
    } else if (cloak.cloakActive) {
      UI.notify('Cloak already active', 'warn');
    } else if (cloak.cloakCd > 0) {
      UI.notify(`Cloak recharging (${Math.ceil(cloak.cloakCd)}s)`, 'warn');
    } else {
      UI.notify('Cloak needs power', 'warn');
    }
  }

  function _mapToggleRect() {
    // Sits BELOW the resources row (which spans y 10-36 at top-center)
    return { x: Renderer.getWidth() / 2 - 75, y: 42, w: 150, h: 24 };
  }

  function _holdBtnRect() {
    // Third row, under the map/ship toggle.
    return { x: Renderer.getWidth() / 2 - 75, y: 70, w: 150, h: 24 };
  }

  function _drawMapToggle(ctx) {
    // Cargo hold is reachable from either map view — you pack between
    // jumps, and a full hold is a decision you want to see coming.
    const hb = _holdBtnRect();
    const hold = _playerShip?.cargo;
    const hot  = Utils.pointInRect(Input.mouse.x, Input.mouse.y, hb.x, hb.y, hb.w, hb.h);
    const warn = hold?.hasLiveHazard?.();
    ctx.fillStyle = hot ? 'rgba(26,140,255,0.18)' : 'rgba(13,17,32,0.92)';
    ctx.beginPath(); ctx.roundRect(hb.x, hb.y, hb.w, hb.h, 4); ctx.fill();
    ctx.strokeStyle = warn ? '#ff5566' : '#4db8ff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = warn ? '#ff5566' : '#4db8ff';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    const used = hold ? `${hold.usedCells()}/${hold.capacity}` : '—';
    ctx.fillText(`${warn ? '⚠' : '▣'} CARGO ${used}  [C]`, hb.x + hb.w / 2, hb.y + 17);

    const b = _mapToggleRect();
    ctx.fillStyle = 'rgba(13,17,32,0.92)';
    ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 4); ctx.fill();
    ctx.strokeStyle = '#4db8ff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#4db8ff';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(_mapView === 'map' ? '⇄ SHOW SHIP  [M]' : '⇄ SHOW MAP  [M]',
                 b.x + b.w / 2, b.y + 17);
  }

  function _drawMap(ctx) {
    Renderer.drawBackground(0);
    if (_mapView === 'ship') {
      // SHIP view — full-size ship, crew management between jumps
      if (_playerShip) _playerShip.draw(ctx);
      _drawCrewSelection(ctx);
    } else {
      // MAP view — centered sector map
      Renderer.drawMapScreen(_sectorMap, _mapHover);
    }
    Renderer.drawHUD({ playerShip: _playerShip });
    _drawMapToggle(ctx);
  }

  /** FTL escape rules: working engines + manned working cockpit, never vs boss */
  /* ── THE ESCAPE POD (update50) ────────────────────────────
   *
   * The one chip that is SPENT, and the only way a captain survives a
   * contract that has already been lost.
   *
   * It is deliberately not a get-out-of-jail card. The countdown runs
   * while the fight goes on — 12 seconds at level I, 6 at IV — and if
   * the hull dies or the last living crewman dies before it ends, the
   * captain dies with them. What he buys with it is his own levels,
   * his karma and his remaining chips; what he pays is the ship, the
   * hold, the cat and every hand aboard, who surrender and do not come
   * home. There is no ransom system and there is not going to be one.
   *
   * And then karma takes 10 off him for it, AFTER the pod is away —
   * the penalty must never be able to switch off the very pod that is
   * carrying him.
   */
  function _podRect() {
    return { x: Renderer.getWidth() / 2 - 65, y: 102, w: 130, h: 26 };
  }

  /** Seconds on the mounted, working pod — 0 when there is none. */
  function _podSeconds() {
    if (!_captain || typeof Captain === 'undefined') return 0;
    return Captain.podSeconds?.() ?? 0;
  }

  function _evacRunning() { return _evacT > 0; }

  function _startEvac() {
    if (_evacRunning()) return false;
    const secs = _podSeconds();
    if (!secs) {
      UI.notify('Brak sprawnej kapsuły — chip musi być ZAMONTOWANY i aktywny.', 'warn');
      return false;
    }
    _evacT = secs; _evacSecs = secs;
    UI.notify(`KAPSUŁA: ${secs} s do odstrzału. Walka trwa.`, 'alert');
    return true;
  }

  /** One tick of the countdown. Called from the combat update. */
  function _tickEvac(dt) {
    if (!_evacRunning()) return;
    _evacT -= dt;
    if (_evacT > 0) return;
    _evacT = 0;
    _completeEvac();
  }

  /** The pod is away. Everything below this line is a loss except him. */
  function _completeEvac() {
    const cap = _captain;
    if (!cap) return;

    // The pod is SPENT: find the one that flew and take it off the board.
    if (typeof Chips !== 'undefined') {
      const board = Chips.board(cap);
      const pods = board.items
        .filter(it => it.def.chipKey === 'escape_pod' && !Chips.isInert(cap, it))
        .sort((a, b) => (a.def.chipLevel ?? 1) - (b.def.chipLevel ?? 1));
      // The best one flies — the same one podSeconds() promised.
      const flown = pods.sort((a, b) =>
        (CHIP_DEFS.escape_pod.v[(a.def.chipLevel ?? 1) - 1])
        - (CHIP_DEFS.escape_pod.v[(b.def.chipLevel ?? 1) - 1]))[0];
      if (flown) board.remove(flown);
      Chips.commit(cap, board);
    }

    // He is home, with his levels and whatever else was mounted.
    cap.away = false;
    cap.escapes = (cap.escapes ?? 0) + 1;
    Base.saveCaptain?.(cap);

    /* THE PENALTY IS LAST. Taking the karma first could move the wall
       under the pod and make the escape impossible halfway through
       its own countdown. */
    if (typeof Captain !== 'undefined') {
      const r = Captain.shift(cap, Captain.KARMA.EVACUATE);
      Base.saveCaptain?.(cap);
      if (r) {
        UI.notify(`${cap.name} zostawił żywą załogę: karma ${r.from} → ${r.to}`
                + (r.killed ? ` — ${r.killed} chip(ów) zgasło` : ''), 'warn');
      }
    }

    UI.notify(`${cap.name} odstrzelony. Statek, ładownia i załoga zostają.`, 'alert');
    _captain = null;          // so _onLose does not bury him as well
    Captain?.setActive?.(null);
    _evacT = 0; _evacSecs = 0;
    _onLose();
  }

  /* ── ORDERS NEED A CAPTAIN (update51) ──────────────────────
   *
   * A ship without a captain still FLIES: the crew walk where you
   * point them, man consoles, put out fires, patch breaches, fire the
   * guns, and you still move power around. What it cannot do is
   * anything that is an ORDER TO THE SHIP AS A WHOLE — doors, the
   * boarding party, saved stations, and running away. Those are the
   * chair's job, and now they need someone sitting in it.
   *
   * This is one predicate with one message, deliberately: four copies
   * of "if there is no captain" would drift apart the first time the
   * wording changed, and a button that draws as enabled but refuses to
   * act is the worst outcome here. The renderer asks the same
   * question through Game.hasCaptain().
   */
  function _hasCaptain() { return !!_captain; }

  /** Refuse an order and say why. Returns TRUE when it refused. */
  function _needCaptain(what) {
    if (_hasCaptain()) return false;
    UI.notify(`Bez kapitana nie wydasz rozkazu: ${what}`, 'warn');
    return true;
  }

  function _canRetreat() {
    if (_needCaptain('ODWRÓT')) return false;
    if (BossManager.isActive) {
      UI.notify('Cannot escape Apophis!', 'alert');
      return false;
    }
    /* RUNNING IS A JUMP, AND A JUMP COSTS He2 (update40).
       This checked engines and cockpit but never fuel, while _travelTo
       did — so with an empty hold you could not jump on the map, but
       you could still escape a fight for nothing. That made the whole
       "He2 is a real item" rule optional. */
    if (_fuelAboard() <= 0) {
      UI.notify('No He2 in the hold — nothing to jump WITH!', 'alert');
      return false;
    }
    const eng = _playerShip?.getSystem('engines');
    const pil = _playerShip?.getSystem('piloting');
    if (!eng || eng.effectivePower() <= 0) {
      UI.notify('Engines offline — cannot jump!', 'alert');
      return false;
    }
    if (!pil || pil.effectivePower() <= 0) {
      UI.notify('Cockpit offline — cannot jump!', 'alert');
      return false;
    }
    return true;
  }

  /** Click near a door toggles it (interior: auto→open→closed; airlock: closed↔open) */
  function _handleDoorClick() {
    if (!_playerShip) return false;
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (const d of _playerShip.doors) {
      if (Utils.dist(mx, my, d.x, d.y) < 16) {
        /* The refusal returns TRUE: the click landed on a door, so it
           is spent whether or not the door moves. Doors sit on room
           WALLS, so today nothing else would claim that pixel either
           way — this is belt and braces, not a fix for a live bug. */
        if (_needCaptain('drzwi')) return true;
        d.toggle();
        if (d.isAirlock && d.open) UI.notify('Airlock OPEN — venting!', 'warn');
        return true;
      }
    }
    return false;
  }

  // ── Rubber-band crew selection (Windows/FTL style) ────────
  let _dragStart   = null;    // {x,y} where LMB went down
  let _dragActive  = false;   // moved far enough to count as a drag
  let _pressConsumed = false; // press hit a UI button/door — no select/move
  let _pressHadWeapon = false; // press was a weapon-targeting click
  let _lastCrewClick = { c: null, t: 0 };   // double-click detection

  function _crewUnderCursor(mx, my) {
    if (!_playerShip) return null;
    // `alive` (not just "not dead") — a DOWNED body lying on the floor
    // takes no orders, so it must not swallow the click. It used to:
    // clicking a wrecked room that had wounded in it just re-selected
    // a body instead of sending the repair crew in.
    // Radius is sprite-tight (13px). It used to be 20, which made a
    // crew member standing anywhere near the middle of a module eat
    // every click aimed at that module — you'd just keep re-selecting
    // him instead of ordering the repair you wanted.
    // The anchor is c.y - 1, the sprite's real centre. It used to be
    // c.y - 14, thirteen pixels above his head, so the hot spot sat on
    // the crewman's name plate rather than on the crewman.
    //
    // And it is an ELLIPSE the size of the drawn ring, not a circle:
    // a man is 9px wide and 26 tall, so a 13px circle claimed four
    // pixels of module either side of him for nothing. Matching the
    // ring means what you can click is exactly what you can see.
    /* `c.isPlayer` (update42): this used to match ANY living body in
       _playerShip.crew, so an enemy boarder standing on your deck could
       be clicked, selected, added to a group and ORDERED AROUND YOUR
       SHIP like one of your own. */
    const own = _playerShip.crew.find(c => c.isPlayer && c.alive && _hitsCrew(mx, my, c));
    if (own) return own;
    // Your boarders on the ENEMY ship are selectable the same way
    if (_enemyShip) {
      return _enemyShip.crew.find(c =>
        c.isPlayer && !c.dead && !c.dying && _hitsCrew(mx, my, c, 1.4)) ?? null;
    }
    return null;
  }

  /** Inside the selection ring? rx/ry match _drawCrewSelection exactly. */
  function _hitsCrew(mx, my, c, scale = 1) {
    const rx = 8 * scale, ry = 14 * scale;
    const dx = (mx - c.x) / rx, dy = (my - (c.y - 1)) / ry;
    return dx * dx + dy * dy <= 1;
  }

  /** Runs every frame in map AND combat: press bookkeeping, drag
   *  rectangle, and click-vs-drag resolution on release. */
  function _crewMouseUpdate() {
    if (!_playerShip) return;
    const mx = Input.mouse.x, my = Input.mouse.y;

    if (Input.mouse.leftPressed) {
      // OR, not assign: _updateCombat handles the BOARD/RECALL/RETREAT
      // buttons BEFORE this runs and flags the press as spent. Assigning
      // here wiped that flag, so the same press fell through to
      // _crewClickResolve, hit no room, and cleared the selection.
      _pressConsumed = _handlePowerBarClick() || _handleDoorClick() || _pressConsumed;
      _pressHadWeapon = !!_selectedWeapon;   // weapon targeting wins the click
      _dragStart  = _pressConsumed ? null : { x: mx, y: my };
      _dragActive = false;
    }

    if (_dragStart && Input.mouse.leftDown &&
        Utils.dist(mx, my, _dragStart.x, _dragStart.y) > 8) {
      _dragActive = true;
    }

    if (Input.mouse.leftReleased) {
      const additive = Input.isHeld('ShiftLeft') || Input.isHeld('ShiftRight');
      if (_dragActive && _dragStart) {
        // Rubber-band: select every living crew member inside the box
        const x0 = Math.min(_dragStart.x, mx), x1 = Math.max(_dragStart.x, mx);
        const y0 = Math.min(_dragStart.y, my), y1 = Math.max(_dragStart.y, my);
        const pool = [..._playerShip.crew.filter(c => c.isPlayer),
          ...(_enemyShip ? _enemyShip.crew.filter(c => c.isPlayer) : [])];
        const hit = pool.filter(c => !c.dead && !c.dying &&
          c.x >= x0 && c.x <= x1 && c.y - 1 >= y0 && c.y - 1 <= y1);
        if (hit.length || !additive) UI.selectCrewGroup(hit, additive);
        if (hit.length) UI.notify(`${hit.length} crew selected`, 'info');
      } else if (!_pressConsumed && !_dragActive) {
        _crewClickResolve(mx, my, additive);
      }
      _dragStart = null; _dragActive = false; _pressConsumed = false;
    }
  }

  /** Plain click: crew sprite → select (dbl-click = select ALL);
   *  otherwise a room click sends the WHOLE selection there. */
  function _crewClickResolve(mx, my, additive) {
    const sel0 = UI.getSelectedCrewAll();
    const c = _crewUnderCursor(mx, my);

    /* CLICKING A CREWMAN ALWAYS PICKS HIM UP.
     *
     * update34 made a live selection turn every click into an ORDER, so
     * that the console operator standing in the middle of a module could
     * not eat the click aimed at that module. It worked — and it broke
     * the most ordinary gesture in the game: clicking one crewman while
     * another was selected no longer switched to him.
     *
     * Switching wins. The room click is protected by geometry instead:
     * the hot spot is the SILHOUETTE (an ellipse the size of the drawn
     * selection ring, not a 13px circle around a point above his head),
     * and the operator stands high in the room rather than dead on its
     * centre — so there is always most of a module left to click. */
    if (c) {
      const now = performance.now();
      if (_lastCrewClick.c === c && now - _lastCrewClick.t < 350) {
        UI.selectCrewGroup(Renderer.crewRoster({
          playerShip: _playerShip, enemyShip: _enemyShip,
        }).filter(k => !k.dead && !k.dying));
        UI.notify('All crew selected', 'info');
      } else {
        UI.selectCrew(c, additive);
      }
      _lastCrewClick = { c, t: now };
      return;
    }
    const sel = sel0;
    if (!sel.length) return;

    // ── Boarder orders: clicking an ENEMY room moves YOUR crew who
    //    are aboard the enemy ship — exactly like moving at home. ──
    if (_enemyShip && !_pressHadWeapon && STATE === 'combat') {
      const eRoom = _enemyShip.rooms.find(r => r.contains(mx, my));
      if (eRoom) {
        const aboard = sel.filter(c => _enemyShip.crew.includes(c));
        if (aboard.length) {
          const occ = _enemyShip.crew.filter(c => c.isPlayer &&
            !c.dead && !c.dying && !aboard.includes(c) &&
            (c.roomId === eRoom.id || c.homeRoomId === eRoom.id)).length;
          const movers = aboard.slice(0, Math.max(0, 3 - occ));
          if (!movers.length) { UI.notify('Module full (max 3 crew)', 'warn'); return; }
          // Free SPOTS, not head counts — same rule as at home, so a
          // boarding party of three does not pile onto one console.
          const picks = _enemyShip.allocStationSlots(eRoom, movers);
          movers.forEach((m, i) => {
            const [tx, ty] = _enemyShip.stationSlot(eRoom, picks[i]);
            m.homeRoomId = eRoom.id;
            m._ordered   = true;   // boarder AI stops auto-roaming
            m.moveToOnShip(_enemyShip, tx, ty);
          });
          return;
        }
      }
    }

    const room = _playerShip.rooms.find(r => r.contains(mx, my));
    // Clicking off the hull drops the selection — the counterpart to
    // "a live selection turns clicks into orders", and the way you get
    // back to picking an individual crew member.
    if (!room) {
      if (!(_enemyShip && _enemyShip.rooms.some(r => r.contains(mx, my)))) {
        UI.selectCrewGroup([]);
      }
      return;
    }
    // Boarders still aboard the ENEMY hull can't just walk into a room
    // on OUR ship — they're not physically here. Use RECALL to bring
    // them home first (this used to silently teleport their move
    // target while they stayed registered as enemy crew — the "fly
    // home then re-breach the same door" glitch).
    const homeSel = sel.filter(c => _playerShip.crew.includes(c));
    if (!homeSel.length) {
      if (_enemyShip && sel.some(c => _enemyShip.crew.includes(c))) {
        UI.notify('They’re still aboard the enemy ship — use RECALL.', 'warn');
      }
      return;
    }
    // ROOM CAPACITY: a module holds at most 3 ABLE crew. Downed bodies
    // lying on the floor must NOT count — a room with three wounded in
    // it used to read as "full", silently refusing every repair order
    // (that's why a breached, shot-out module could look unfixable).
    const occupied = _playerShip.crew.filter(c =>
      c.alive && !homeSel.includes(c) &&
      (c.roomId === room.id || c.homeRoomId === room.id)).length;
    const space = Math.max(0, 3 - occupied);
    if (space === 0) { UI.notify('Module full (max 3 crew)', 'warn'); return; }
    const movers = homeSel.slice(0, space);
    if (movers.length < homeSel.length) {
      UI.notify(`Module full — only ${movers.length} sent (max 3)`, 'warn');
    }
    // FTL: sent crew STAY — home follows the order; spread them out
    const breach = _playerShip.breaches.getBreachesInRoom(room.id)[0];
    const needsRepair = room.system && room.system.damagedLevels > 0;
    /* Slot 0 is the CONSOLE, slot 1 the left of it, slot 2 the right.
     *
     * The spots are handed out by Ship.allocStationSlots, which looks at
     * which spots are actually HELD — by men standing on them and by men
     * walking to them — instead of counting heads. Counting heads was
     * wrong twice over: the man already in the room might himself be
     * standing on the left flank (so "one head, you take slot 1" put the
     * newcomer inside him), and three movers sent together all measured
     * the room before any of them had moved, so they stacked. */
    const picks = _playerShip.allocStationSlots(room, movers);
    movers.forEach((m, i) => {
      const [tx, ty] = _playerShip.stationSlot(room, picks[i]);
      m.homeRoomId = room.id;
      m.moveToOnShip(_playerShip, tx, ty);
      // Sending crew INTO a damaged or holed room is an explicit repair
      // order — don't rely on the idle auto-task noticing after arrival
      // (a fire, a passing order or a re-route could eat it first).
      if (breach)           m.assignTask(TASK.BREACH, breach);
      else if (needsRepair) m.assignTask(TASK.REPAIR, room.id);
    });
    if (breach)           UI.notify('Sealing hull breach…', 'info');
    else if (needsRepair) UI.notify(`Repairing ${room.system.label}…`, 'info');
  }

  /** Selection visuals: rings under selected crew + drag rectangle */
  function _drawCrewSelection(ctx) {
    if (!_playerShip) return;
    /* A SMALL EGG AT THE BOOTS.
     *
     * This has been round the houses: a flat shadow, then a full-body
     * outline — which at 26x38 was three times the width of the man and
     * made a crowded module unreadable — and now back to the marker the
     * player actually wanted. A little ellipse on the deck under him,
     * kept small so three of them in one room still read as three.
     *
     * The CLICK target is deliberately NOT this shape: you click the
     * man, not his shadow, so _hitsCrew stays body-sized. */
    UI.getSelectedCrewAll().forEach(c => {
      ctx.save();
      ctx.fillStyle = 'rgba(26,255,140,0.20)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 4, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(26,255,140,0.95)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 4, 7, 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
    if (_dragActive && _dragStart) {
      const mx = Input.mouse.x, my = Input.mouse.y;
      ctx.fillStyle   = 'rgba(26,140,255,0.12)';
      ctx.strokeStyle = '#4db8ff';
      ctx.lineWidth   = 1;
      const x = Math.min(_dragStart.x, mx), y = Math.min(_dragStart.y, my);
      const w = Math.abs(mx - _dragStart.x), h = Math.abs(my - _dragStart.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  }

  /** Open or close EVERY door at once — interior AND airlocks.
   *  Opening all with airlocks vents the ship, so warn loudly. */
  function _setAllDoors(open) {
    if (!_playerShip) return;
    if (_needCaptain(open ? 'OTWÓRZ WSZYSTKIE' : 'ZAMKNIJ WSZYSTKIE')) return;
    let moved = 0;
    _playerShip.doors.forEach(d => {
      // Set the LATCH, not the panel — `open` is now derived from the
      // slide animation, so writing it directly would just be undone.
      const want = open ? 'open' : 'closed';
      if (d.mode !== want) { d.mode = want; d._tempT = 0; moved++; }
    });
    Audio.sfx.uiClick();
    /* OPEN ALL / CLOSE ALL were silent (update42): they wrote d.mode
       by hand instead of going through Door.toggle(), so the one place
       doorMove() is played was bypassed and the whole ship's doors
       cycled without a sound. */
    if (moved) Audio.sfx.doorMove?.();
    UI.notify(open ? 'ALL doors open — airlocks VENTING!' : 'All doors CLOSED',
              open ? 'warn' : 'info');
  }

  /** PHYSICAL boarding: the selected crew WALK to your airlock,
   *  step outside, drift slowly across the void to the enemy's
   *  airlock, SMASH its door open (takes a while), then storm in.
   *  Non-Pegasus crew suffocate the whole way. */
  function _launchBoarders() {
    if (!_enemyShip || _boardingParty) return;
    if (_needCaptain('ABORDAŻ')) return;
    // Only crew still aboard OUR ship can be sent — boarders already on
    // the enemy hull are handled by RECALL instead (see _recallBoarders).
    const sel = UI.getSelectedCrewAll()
      .filter(c => c.alive && _playerShip.crew.includes(c)).slice(0, 3);
    if (!sel.length) { UI.notify('Select crew to board with.', 'warn'); return; }
    const party = _makeParty(_playerShip, _enemyShip, sel);
    if (!party) { UI.notify('No airlock route to the enemy!', 'warn'); return; }
    _boardingParty = party;
    // The selection SURVIVES the launch. Boarders stay yours: they are
    // still drawn with their rings, still listed on the roster, and are
    // still the crew you are giving orders to the moment they land.
    // Dropping it here meant you had to re-select everybody on the
    // enemy hull before you could tell them anything.
    _pressConsumed = true;
    Audio.sfx.uiClick();
    UI.notify(`⚔ Boarding action — crew heading for the airlock`, 'warn');
  }

  /** Bring boarders HOME: selected crew currently aboard the enemy hull
   *  fly back through their own (already-breached) airlock, cycle open
   *  our OWN airlock (quick, not smashed), and rejoin the roster. */
  function _recallBoarders() {
    _pressConsumed = true;
    if (!_enemyShip || !_playerShip || _boardingParty) return;
    const sel = UI.getSelectedCrewAll()
      .filter(c => c.alive && c.isPlayer && _enemyShip.crew.includes(c)).slice(0, 3);
    if (!sel.length) { UI.notify('Select boarders on the enemy ship to recall.', 'warn'); return; }
    const party = _makeParty(_enemyShip, _playerShip, sel, { recall: true });
    if (!party) { UI.notify('No airlock route home!', 'warn'); return; }
    _boardingParty = party;
    Audio.sfx.uiClick();
    UI.notify('⚓ Boarding party pulling back to the ship', 'warn');
  }

  /** Build a party: members first WALK to fromShip's facing airlock,
   *  then fly to toShip's facing airlock, break it, and enter.
   *  opts.recall marks a RETURN trip home: the destination airlock is
   *  the party's OWN, so it's just cycled open (quick, no permanent
   *  breach) instead of smashed in. */
  function _makeParty(fromShip, toShip, crewList, opts = {}) {
    const recall = !!opts.recall;
    const facingRight = fromShip.worldX < toShip.worldX;
    const exitDoor = fromShip.doors.filter(d => d.isAirlock)
      .sort((a, b) => facingRight ? b.x - a.x : a.x - b.x)[0];
    const entryDoor = toShip.doors.filter(d => d.isAirlock)
      .sort((a, b) => facingRight ? a.x - b.x : b.x - a.x)[0];
    if (!exitDoor || !entryDoor) return null;
    const entryRoom = toShip.getRoomById(entryDoor.roomA) ?? toShip.rooms[0];
    crewList.forEach(c => {
      // Step out of any elevator cabin BEFORE mustering: a boarder who
      // left the ship still flagged as a passenger came home unable to
      // ride, and blocked the shaft for everyone else.
      fromShip.elevators?.release?.(c);
      toShip.elevators?.release?.(c);
      c._waypoints = []; c.task = TASK.IDLE; c.carrying = null;
      c.moveToOnShip(fromShip, exitDoor.x + (facingRight ? -10 : 10), exitDoor.y);
    });
    return {
      fromShip, toShip, exitDoor, entryDoor, entryRoom, facingRight, recall,
      members: crewList.map(c => ({ c, phase: 'muster', x: c.x, y: c.y })),
      breachT: 0, breachNeed: recall ? 1.5 : 4.0, doorBroken: false, t: 0, _sparkT: 0,
    };
  }

  /** One tick of a boarding party (works for BOTH directions). */
  function _updateParty(party, dt) {
    party.t += dt;
    const speed = 85;   // px/s — far slower than any projectile
    const doorSlot = { x: party.entryDoor.x + (party.facingRight ? -16 : 16),
                      y: party.entryDoor.y };

    party.members.forEach(m => {
      const c = m.c;
      if (m.phase === 'muster') {
        // Walking to our own airlock (still a normal crew member)
        m.x = c.x; m.y = c.y;
        const near = Utils.dist(c.x, c.y, party.exitDoor.x, party.exitDoor.y) < 24;
        if (near || party.t > 9) {
          if (!near && party.t > 9) { m.phase = 'cancelled'; return; }
          party.fromShip.crew = party.fromShip.crew.filter(k => k !== c);
          c._waypoints = []; c.task = TASK.IDLE; c.roomId = null;
          m.phase = 'fly';
          m.x = c.x = party.exitDoor.x; m.y = c.y = party.exitDoor.y;
          Audio.sfx.uiClick();
        }
        return;
      }
      if (m.phase === 'cancelled' || m.phase === 'inside') return;

      // The void: no air out here for anyone but Pegasus
      if (c.race !== 'pegasus' && !c.down) c.takeDamage(2.2 * dt, 'suffocation');
      if (c.dead || c.down) {
        /* LOST IN THE VOID MEANS DEAD (update40).
           He was already spliced out of his ship's crew when he cast
           off, so a man who merely went DOWN out here (the 35% roll)
           ended up on nobody's roster: not drawn, not counted, never
           banked at the base and — because he was not `dead` — never
           given a headstone either. He just stopped existing. There is
           no stretcher in vacuum: finish it, and bury him. */
        if (!c.dead) c.killOutright('the void');
        m.phase = 'cancelled';
        UI.notify(`${c.name} was lost in the void…`, 'alert');
        return;
      }

      if (m.phase === 'fly') {
        const dx = doorSlot.x - m.x, dy = doorSlot.y - m.y;
        const d  = Math.hypot(dx, dy);
        if (d < 6) { m.phase = 'wait'; }
        else {
          m.x += (dx / d) * speed * dt;
          m.y += (dy / d) * speed * dt;
          if (Math.random() < 0.3) Particles.emit?.({
            x: m.x - Math.sign(dx) * 10, y: m.y + Utils.randFloat(-3, 3),
            vx: -Math.sign(dx) * 40, vy: 0, ay: 0, color: '#8fd4ff',
            size: 2, sizeEnd: 0, life: 0.35, alpha: 0.7, alphaEnd: 0 });
        }
        c.x = m.x; c.y = m.y;
      }

      if (m.phase === 'wait') {
        c.x = m.x; c.y = m.y + Math.sin(party.t * 5) * 2;
        if (party.doorBroken) {
          // Door's open — climb in
          m.phase = 'inside';
          c.x = party.entryRoom.cx + Utils.randFloat(-16, 16);
          c.y = party.entryRoom.cy + party.entryRoom.h * 0.2;
          c.roomId = party.entryRoom.id;
          c.homeRoomId = party.entryRoom.id;
          c._ordered = false;
          party.toShip.addCrew(c, true);   // keep them in the breached room
        }
      }
    });

    // Breaching: everyone waiting at the door hacks at it together
    const waiting = party.members.filter(m => m.phase === 'wait').length;
    if (waiting > 0 && !party.doorBroken) {
      party.breachT += dt * Math.min(waiting, 2);   // 2nd pair of hands helps
      party._sparkT += dt;
      if (party._sparkT > 0.25) {
        party._sparkT = 0;
        Particles.emit?.({ x: party.entryDoor.x, y: party.entryDoor.y + Utils.randFloat(-8, 8),
          vx: Utils.randFloat(-50, 50), vy: Utils.randFloat(-40, 10), ay: 60,
          color: '#ffd700', size: 2, sizeEnd: 0, life: 0.5, alpha: 0.9, alphaEnd: 0 });
        Audio.sfx.repair?.();
      }
      if (party.breachT >= party.breachNeed) {
        party.doorBroken = true;
        /* HACKED, NOT SMASHED.
           A boarding party used to set `breached = true` on the hatch,
           which pinned it open for the rest of the RUN — that room then
           vented forever, with no repair task in the game that could
           ever seal it. They crack the lock now: the hatch cycles like
           any other door, stays theirs for the fight, and the hull can
           be closed up again afterwards. */
        const side = party.toShip.isPlayer ? 'enemy' : 'player';
        if (party.recall) party.entryDoor.mode = 'open';
        else party.entryDoor.hackOpen(side, 2.4);
        party.entryDoor.openness = 1;
        party.entryDoor.open = true;
        if (party.recall) {
          // Your own airlock — just cycled open for re-entry, not smashed.
          UI.notify('Boarding party cycling back aboard…', 'good');
        } else {
          Camera.shake?.(4);
          UI.notify(party.toShip.isPlayer
            ? '⚠ ENEMY BOARDERS HACKED OUR AIRLOCK!'
            : '⚔ AIRLOCK HACKED — BOARDERS ARE IN!', 'alert');
          Audio.sfx.bossWarning?.();
        }
      }
    }

    party.members = party.members.filter(m =>
      m.phase !== 'cancelled' && m.phase !== 'inside');
    return party.members.length === 0;   // true → party done
  }

  /** Draw crew in transit + the breach progress arc */
  function _drawParty(ctx, party) {
    party.members.forEach(m => {
      if (m.phase === 'muster' || m.phase === 'cancelled' || m.phase === 'inside') return;
      m.c.draw(ctx);
    });
    if (!party.doorBroken &&
        party.members.some(m => m.phase === 'wait')) {
      const p = Utils.clamp(party.breachT / party.breachNeed, 0, 1);
      ctx.beginPath();
      ctx.arc(party.entryDoor.x, party.entryDoor.y, 16,
              -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  function _partyArrive(party, targetShip, label) {
    const rooms = targetShip.rooms.filter(r => r.system);
    party.crew.forEach((c, i) => {
      const room = rooms.length ? rooms[(i + (targetShip.weaponRooms[0] ? 0 : 1)) % rooms.length]
                                : targetShip.rooms[0];
      const spot = targetShip.weaponRooms[0] && i === 0 ? targetShip.weaponRooms[0] : room;
      c.x = spot.cx + Utils.randFloat(-14, 14);
      c.y = spot.cy + spot.h * 0.15;
      c.roomId = spot.id;
      c.homeRoomId = spot.id;
      targetShip.addCrew(c);
    });
    UI.notify(label, 'alert');
    Audio.sfx.bossWarning?.();
  }

  /** Survivors head home the moment a fight ends any way at all */
  function _recoverBoarders() {
    // Clear the parties FIRST so the update loop can't re-process them
    // this frame (that caused boarders to "fly out again" on victory).
    const party = _boardingParty;
    _boardingParty = null;
    _enemyParty    = null;
    // A recall in progress had its own airlock cycled open (not
    // smashed) — reseal it since the flight is being cut short here.
    if (party && party.recall && party.doorBroken) party.entryDoor.mode = 'closed';

    const seen = new Set();
    // Anyone still in transit turns around and climbs back in.
    if (party) {
      party.members.forEach(m => {
        if (m.phase === 'cancelled' || m.c.dead) return;
        if (seen.has(m.c)) return;
        seen.add(m.c);
        // If they'd already boarded the enemy, pull them off it first.
        if (_enemyShip) _enemyShip.crew = _enemyShip.crew.filter(k => k !== m.c);
        _returnBoarder(m.c);
      });
    }
    // Anyone who made it onto the enemy hull comes home too (the
    // fallen stay behind on the wreck).
    if (_enemyShip) {
      _enemyShip.crew.filter(c => c.isPlayer).forEach(c => {
        _enemyShip.crew = _enemyShip.crew.filter(k => k !== c);
        if (seen.has(c)) return;      // already handled above
        seen.add(c);
        if (!c.dead) _returnBoarder(c);
      });
    }
    _purgeIntruders();
  }

  /* THE ENEMY DOES NOT GET TO STAY (update42).
     `_recoverBoarders` pulled OUR people off the enemy hull but there
     was no mirror image: an enemy boarder still standing aboard your
     ship when the fight ended simply remained in `_playerShip.crew`
     forever. He got a roster row, he was selectable and orderable, he
     was counted at the docking bay and BANKED INTO YOUR BARRACKS, and
     he was written into the save. Whoever is left of the boarding party
     when their ship is gone goes out with it.
     Beasts are deliberately spared: a spider or a moon rat aboard your
     hull is an INFESTATION and is supposed to persist. */
  function _purgeIntruders() {
    if (!_playerShip) return;
    const intruders = _playerShip.crew.filter(c => !c.isPlayer && !c.isBeast);
    if (!intruders.length) return;
    const alive = intruders.filter(c => !c.dead && !c.dying).length;
    _playerShip.crew = _playerShip.crew.filter(c => c.isPlayer || c.isBeast);
    intruders.forEach(c => {
      if (c.carriedBy) c.carriedBy.carrying = null;
      if (c.carrying)  c.carrying.carriedBy = null;
      _playerShip.elevators?.release?.(c);
    });
    _playerShip.crew.forEach(c => {
      if (intruders.includes(c.carrying)) c.carrying = null;
      if (intruders.some(i => i.id === c._rescueId)) c._rescueId = null;
    });
    if (alive) {
      UI.notify(alive === 1 ? 'The last boarder is thrown out of the airlock.'
                            : `${alive} enemy boarders are thrown out of the airlock.`, 'good');
    }
  }

  function _returnBoarder(c) {
    const room = _playerShip.getRoomById(_playerShip.getSystem('medbay')?.roomId)
              ?? _playerShip.rooms[0];
    c.x = room.cx + Utils.randFloat(-16, 16);
    c.y = room.cy + 8;
    c.roomId = room.id; c.homeRoomId = room.id;
    c._waypoints = []; c.task = TASK.IDLE;
    c._ordered = false; c.carrying = null; c.carriedBy = null;
    // Whatever cabin they were flagged into before they left, they are
    // out of it now — including a shaft on the ENEMY hull.
    _playerShip.elevators?.release?.(c);
    _enemyShip?.elevators?.release?.(c);
    c._ridingShaft = null; c._elevatorArrived = false;
    c._pathRetryCd = 0;
    _playerShip.addCrew(c);
    UI.notify(`${c.name} is back aboard.`, 'good');
  }

  /** Every living crew member LOYAL to the player, wherever they are:
   *  aboard our ship, mid-flight in a boarding pod, or fighting on the
   *  enemy hull. Used so a full-crew boarding action doesn't read as
   *  "everyone died" and end the game. */
  function _playerCrewAliveCount() {
    // Boarders and loose SPIDERS both live in _playerShip.crew — only
    // your own people count, or a ship full of spiders would read as
    // "still crewed" after they had killed everybody.
    let n = _playerShip
      ? _playerShip.crew.filter(c => c.isPlayer && !c.dead && !c.dying).length : 0;
    if (_boardingParty) {
      // 'muster' members are still counted in _playerShip.crew above;
      // only count boarders who have already LEFT the ship (fly/wait).
      n += _boardingParty.members.filter(m =>
        m.phase !== 'cancelled' && m.phase !== 'muster' &&
        !m.c.dead && !m.c.dying).length;
    }
    if (_enemyShip) {
      n += _enemyShip.crew.filter(c =>
        c.isPlayer && !c.dead && !c.dying).length;
    }
    return n;
  }

  /** Snapshot every living crew member's current room (FTL "save stations") */
  function _saveStations() {
    if (!_playerShip) return;
    if (_needCaptain('ZAPISZ POZYCJE')) return;
    _savedStations = new Map();
    _playerShip.crew.forEach(c => {
      if (!c.dead && c.roomId) _savedStations.set(c.id, c.roomId);
    });
    Audio.sfx.uiClick();
    UI.notify('Crew positions saved', 'good');
  }

  /** Send everyone back to their saved rooms (FTL "return to stations") */
  function _returnToStations() {
    if (!_playerShip) return;
    if (_needCaptain('NA STANOWISKA')) return;
    if (!_savedStations || !_savedStations.size) {
      UI.notify('No saved positions — use SAVE first', 'warn');
      return;
    }
    let sent = 0;
    /* Everyone returning to one room gets a DIFFERENT slot — console,
       then left, then right. This used to send every one of them to
       room.cx/room.cy, so three crew stacked on the exact same pixel;
       then it counted returnees per room, which still ignored anyone
       already standing in there who was NOT recalled. Group them by
       room and let the ship allocate. */
    const byRoom = new Map();
    _playerShip.crew.forEach(c => {
      if (c.dead || c.dying) return;
      const roomId = _savedStations.get(c.id);
      const room   = roomId ? _playerShip.getRoomById(roomId) : null;
      if (!room) return;
      if (!byRoom.has(room.id)) byRoom.set(room.id, { room, movers: [] });
      byRoom.get(room.id).movers.push(c);
    });
    byRoom.forEach(({ room, movers }) => {
      const picks = _playerShip.allocStationSlots(room, movers);
      movers.forEach((c, i) => {
        c.homeRoomId = room.id;          // idle logic keeps them there
        c.moveToOnShip(_playerShip, ..._playerShip.stationSlot(room, picks[i]));
        sent++;
      });
    });
    Audio.sfx.uiClick();
    if (sent) UI.notify('Crew returning to stations', 'info');
  }

  /** Handle clicks on the FTL-style bottom power bar (pips + weapons) */
  function _handlePowerBarClick() {
    if (!_playerShip) return false;
    const zones = Renderer.getPowerClickZones();
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (const z of zones) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      if (z.crewSave)   { _saveStations();     return true; }
      if (z.crewReturn) { _returnToStations(); return true; }
      if (z.doorsOpen)  { _setAllDoors(true);  return true; }
      if (z.doorsClose) { _setAllDoors(false); return true; }
      if (z.sysIndex !== undefined) {
        const sys = _playerShip.systems[z.sysIndex];
        if (!sys) return;
        // Clicking a lit pip removes power down to that pip;
        // clicking an unlit pip adds power up to that pip.
        const target = z.pip < sys.power ? z.pip : z.pip + 1;
        _playerShip.setPowerAt(z.sysIndex, target);
        return true;
      }
      if (z.weapon !== undefined) {
        const w = _playerShip.weapons[z.weapon];
        if (w && w.armed && CombatManager.isActive()) {
          // Select weapon — next click on an enemy room fires at it
          _selectedWeapon = (_selectedWeapon === w) ? null : w;
          Audio.sfx.uiClick();
          if (_selectedWeapon) UI.notify(`${w.label} — click enemy room to target`, 'info');
        }
        return true;
      }
      if (z.weaponAuto !== undefined) {
        const w = _playerShip.weapons[z.weaponAuto];
        if (w) {
          w.autoFire = !w.autoFire;
          Audio.sfx.uiClick();
          UI.notify(`${w.label}: AUTO ${w.autoFire ? 'ON' : 'OFF'}`, 'info');
        }
        return true;
      }
      if (z.sysActivateIndex !== undefined) {
        const sys = _playerShip.systems[z.sysActivateIndex];
        if (sys && sys.type === 'cloaking') _activateCloak(sys);
        return true;
      }
      // The reactor is a module too — its icon scrams the whole plant.
      if (z.reactorToggle !== undefined) {
        const r = _playerShip.reactor;
        r.offline = !r.offline;
        Audio.sfx.uiClick();
        UI.notify(r.offline ? 'REACTOR SCRAMMED — everything is dark'
                            : 'Reactor back online', r.offline ? 'alert' : 'good');
        return;
      }
      if (z.sysToggleIndex !== undefined) {
        const sys = _playerShip.systems[z.sysToggleIndex];
        if (sys) {
          if (sys.power > 0) {
            sys._prefPower = sys.power;   // remember for re-enable
            _playerShip.setPowerAt(z.sysToggleIndex, 0);
            UI.notify(`${sys.label} OFFLINE`, 'warn');
          } else {
            const want = sys._prefPower ?? sys.maxPower;
            _playerShip.setPowerAt(z.sysToggleIndex, want);
            UI.notify(`${sys.label} ONLINE`, 'good');
          }
        }
        return true;
      }
      if (z.crewIndex !== undefined) {
        // crewRef, not an index into _playerShip.crew — the roster now
        // spans both hulls while a boarding party is away (update42).
        const c = z.crewRef ?? _playerShip.crew[z.crewIndex];
        if (c) {
          const additive = Input.isHeld('ShiftLeft') || Input.isHeld('ShiftRight');
          const all = UI.getSelectedCrewAll();
          // Clicking the only selected member deselects; shift toggles
          if (!additive && all.length === 1 && all[0] === c) UI.deselectCrew();
          else UI.selectCrew(c, additive);
        }
        return true;
      }
    }
    return false;
  }

  function _travelTo(nodeId) {
    if (!_sectorMap) return;
    const wasPicking = _sectorMap.awaitingStartPick;
    // Every FTL jump burns 1 He2. Choosing the starting lane in sector 1
    // is not a jump, so it stays free.
    if (!wasPicking) {
      // THE CELLS ARE THE TANK (update39): no He2 in the hold, no jump.
      if (_fuelAboard() <= 0) {
        /* SAY SO OUT LOUD (update42). This bounced straight into the
           beacon with no message at all, so the refusal was invisible
           and — because the beacon always handed over fuel — the jump
           read as if it had simply gone through. */
        UI.notify('DRIVE WILL NOT SPIN UP — no He2 cells in the hold.', 'alert');
        // Stranded: broadcast a distress call instead of a dead end.
        _maybeSOS();
        return;
      }
    }
    if (!_sectorMap.travelTo(nodeId)) return;
    Audio.sfx.uiClick();
    const node = _sectorMap.getNode(nodeId);
    _sectorMap.unlockNext();

    if (!wasPicking) {
      // One cell out of the racks per jump — a real item leaving a real
      // shelf, not a counter going down.
      _burnFuel(1);
      const left = _fuelAboard();
      if (left <= 2) UI.notify(`He2 low: ${left} left`, left === 0 ? 'alert' : 'warn');
      // A jump is also when badly packed cargo bites: an uncooled core
      // spoils whatever is touching it.
      const spoiled = _playerShip?.cargo?.hazardTick?.() ?? [];
      spoiled.forEach(m => UI.notify(m, 'warn'));
      // …and when a full hold picks up passengers nobody invited.
      _rollForRats();
    }

    // Sector 1: this click CHOSE the starting lane — lock the other
    // two entry nodes and remember the lane for save/continue.
    if (wasPicking) {
      _sectorMap.startNodes.forEach(s => { if (s.id !== nodeId) s.locked = true; });
      Save.updateRun({ lane: node.row });
      UI.notify(`Starting lane locked in — ${['TOP','MIDDLE','BOTTOM'][node.row]}`, 'good');
      _saveShip();
      return;   // picking a lane is not a jump — no event fires
    }
    _saveShip();

    _playerShip.reactor.penalty = 0;   // any lingering nebula effect ends
    _nebulaCombat = false;

    const t = node.type;
    if (t === 'combat' || t === 'elite') {
      const diff = t === 'elite' ? 'hard' : 'normal';
      // Sometimes the hostiles would rather extort than fight
      if (t === 'combat' && Math.random() < 0.45) _maybeNegotiate(diff, false);
      else _startCombat(diff, false);
    } else if (t === 'nebula') {
      // Nebula: sometimes an ambush (fought at −2 power for BOTH sides),
      // sometimes a random event hidden in the clouds.
      if (Math.random() < 0.55) {
        if (Math.random() < 0.3) _maybeNegotiate('normal', true);
        else _startCombat('normal', true);
      } else {
        _event = pickEventFor(_playerShip);
        STATE = 'event';
      }
    } else if (t === 'store') {
      _station = new Station(Save.getRun()?.sector ?? 1, Date.now());
      STATE = 'station'; _beginFade();
      UI.openStation(_station, _playerShip);
    } else if (t === 'event' && node.event) {
      /* The node's event was chosen when the SECTOR was generated, and
         the ship changes during the run — a med-bay refit baked into
         column 4 is nonsense by the time you get there with the med bay
         shot off. Re-roll anything that no longer fits the hull. */
      _event = eventFits(node.event, _playerShip)
             ? node.event
             : (node.event = pickEventFor(_playerShip));
      STATE = 'event';
    } else if (t === 'exit') {
      // Exit lane carries over: top exit → top start of the next
      // sector, middle → middle, bottom → bottom.
      Save.updateRun({ lane: node.row });
      _nextSector();
    } else if (t === 'boss') {
      // Resume at the phase already reached — fleeing and coming back
      // does NOT reset Apophis to phase I.
      _enemyShip = BossManager.start(BossManager.phase, 850, 120);
      _playerShip.prechargeShields();
      _playerShip.weapons.forEach(w => { if (w) { w.charge = 0; w.armed = false; w.targetRoom = null; } });
      _playerShip.markCombatStart();
      _surrenderAsked = false;
      _derelictOffered = false;
      STATE = 'combat'; _beginFade();
      _combatTimer = 0;
      _combatFired = false;
      CombatManager.begin(_playerShip, _enemyShip, 'boss');
      Audio.resume(); Audio.playMusic('boss');
      UI.notify('WARNING: APOPHIS', 'alert');
    } else {
      UI.notify('Path clear.', 'info');
    }
  }

  // ── COMBAT ────────────────────────────────────────────────
  function _updateCombat(dt) {
    if (!_playerShip || !_enemyShip) return;
    _playerShip.update(dt);
    _enemyShip.update(dt);

    // ── Boss phase machine — runs BEFORE CombatManager so a downed
    //    phase chains straight into the next one: no victory screen,
    //    no scrap payout, no jump prompt between phases. ──
    if (BossManager.isActive) {
      const bres = BossManager.update(dt);
      if (bres === 'next_phase') {
        CombatManager.end();
        _enemyShip = BossManager.nextPhase(850, 120);
        _combatTimer = 0; _combatFired = false;
        CombatManager.begin(_playerShip, _enemyShip, 'boss');
        UI.notify(`MOTHERSHIP — PHASE ${BossManager.phase + 1}/${BossManager.totalPhases}: "${BossManager.currentPhaseDef.taunt}"`, 'alert');
        Audio.sfx.bossWarning();
        return;
      }
      if (bres === 'defeated') {
        // Contract complete — fly home and dock. Fetch the boarding
        // party FIRST: docking banks _playerShip.crew, so anyone still
        // standing on the boss's hull was quietly deleted from the
        // barracks by winning the fight they had just won for you.
        _recoverBoarders();
        _finishContract();
        CombatManager.end();
        _enemyShip = null;
        return;
      }
    }

    CombatManager.update(dt);

    // Boarding parties: walk out → drift across → breach → storm in
    if (_boardingParty && _updateParty(_boardingParty, dt)) {
      // A recall trip re-seals your own airlock behind the returning
      // crew — it was only cycled open, never smashed (see _makeParty).
      if (_boardingParty.recall) _boardingParty.entryDoor.mode = 'closed';
      _boardingParty = null;
    }
    if (_enemyParty    && _updateParty(_enemyParty, dt))    _enemyParty = null;

    /* `c.alive`, NOT `!c.dead` (update42).
       A crew member who has gone DOWN is hp 1, state 'injured' — he is
       not dead. So the last enemy going down instead of dying meant the
       boarding action could NEVER end: no derelict offer, no wreck
       clear, nothing to do but grind the hull to zero with the guns.
       `alive` is already the "still on his feet" test — it excludes the
       injured and the dying — and a fight is over when nobody is left
       standing, not when the last body stops twitching.

       A DERELICT we boarded: no dialog, no reward roll — the moment the
       nest is dead the hold is ours. */
    if (_wreckMode && !_wreckLooted && _enemyShip &&
        _enemyShip.crew.filter(c => !c.isPlayer && c.alive).length === 0) {
      _wreckCleared();
      return;
    }

    // derelict choice instead of grinding it down turret-by-turret.
    if (!_derelictOffered && !BossManager.isActive && _enemyShip &&
        !_enemyShip.destroyed && _enemyShip.hull > 0 &&
        (CombatManager.isActive() || CombatManager.state === COMBAT_STATE.RETREATING) &&
        _enemyShip.crew.filter(c => !c.isPlayer && c.alive).length === 0) {
      _derelictOffered = true;
      _event = {
        title: 'Derelict Hulk',
        text: 'The enemy crew is wiped out, but their ship still drifts intact. Board it and take what your hold will carry — or just finish it off for CC?',
        choices: [
          { label: 'Board it — strip the hold yourself',
            result: { searchDerelict: true } },
          { label: 'Finish it off — guaranteed CC',
            result: { destroyDerelict: true } },
        ],
      };
      STATE = 'event';
      return;
    }

    // Badly damaged enemies sometimes beg for mercy, offering tribute
    if (CombatManager.surrenderOffer && !_surrenderAsked) {
      _surrenderAsked = true;
      CombatManager.surrenderOffer = false;
      const run    = Save.getRun();
      /* EXTORTION (update49): a Dominacja captain squeezes them for
         more. It changes the PRICE of mercy, never the odds of being
         offered it — the surrender roll upstream is untouched. */
      const squeeze = (typeof Captain !== 'undefined') ? Captain.shipBonus('tribute') : 0;
      const scrap  = Math.round(Utils.randInt(20, 35 + (run?.sector ?? 1) * 5)
                                * (1 + squeeze));
      const offers = [{ scrap }];
      // Sometimes they throw in their gun or a crew member
      const gun = _enemyShip.weapons.find(w => w);
      if (gun && Math.random() < 0.5)            offers[0].weaponReward = gun.defKey;
      else if (_playerShip.crew.length < 8 && Math.random() < 0.5) offers[0].crew = 1;
      const extras = offers[0].weaponReward ? `, their ${gun.label}`
                   : offers[0].crew         ? ', and a crew member defects to you'
                   : '';
      _event = {
        title: 'They Surrender!',
        text: `"Cease fire! Take it — just let us live." They offer ${scrap} CC${extras}.`,
        choices: [
          /* THE FORK THE PLAYER MEETS MOST OFTEN (update50). Taking
             the money and letting them live is mercy with a price on
             it; opening up on a ship that has already struck its
             colours is "świadome zabicie bezbronnych". */
          { label: 'Accept tribute — let them go',
            result: { ...offers[0], acceptSurrender: true,
                      karma: Captain?.KARMA?.HELP_AT_COST ?? 5 } },
          { label: 'No mercy — finish them',
            result: { resumeCombat: true,
                      karma: Captain?.KARMA?.KILL_HELPLESS ?? -10 } },
        ],
      };
      STATE = 'event';
      return;
    }

    // Weapon hotkeys — select weapon (then click enemy room), double-tap = fire random
    ['Digit1','Digit2','Digit3','Digit4'].forEach((code, i) => {
      if (Input.isPressed(code)) {
        const w = _playerShip.weapons[i];
        if (w && w.armed) {
          if (_selectedWeapon === w) {
            // Second press = fire at remembered room (or random if none)
            const t = w.targetRoom && _enemyShip && _enemyShip.rooms.includes(w.targetRoom)
              ? w.targetRoom : null;
            CombatManager.playerFire(w, t);
            _selectedWeapon = null;
          } else {
            _selectedWeapon = w;
            UI.notify(`${w.label} — click enemy room`, 'info');
          }
        }
      }
    });

    // Targeted fire: selected weapon + click on enemy room.
    // The room is REMEMBERED — subsequent shots hit the same module.
    if (_selectedWeapon && Input.mouse.leftPressed && _enemyShip) {
      const wx = Input.mouse.x, wy = Input.mouse.y;
      const room = _enemyShip.rooms.find(r => r.contains(wx, wy));
      if (room) {
        _selectedWeapon.targetRoom = room;
        CombatManager.playerFire(_selectedWeapon, room);
        _selectedWeapon = null;
      }
    }
    // Clear selection if weapon lost charge
    if (_selectedWeapon && !_selectedWeapon.armed) _selectedWeapon = null;

    // AUTO-fire: weapons with autoFire on shoot their remembered room when charged
    _playerShip.weapons.forEach(w => {
      if (!w || !w.autoFire || !w.armed) return;
      if (!CombatManager.isActive() || !_enemyShip) return;
      const target = w.targetRoom && _enemyShip.rooms.includes(w.targetRoom)
        ? w.targetRoom : null;
      CombatManager.playerFire(w, target);
    });

    // BOARD button
    if (Input.mouse.leftPressed) {
      const bb = { x: Renderer.getWidth() / 2 - 210, y: 42, w: 136, h: 26 };
      if (Utils.pointInRect(Input.mouse.x, Input.mouse.y, bb.x, bb.y, bb.w, bb.h)) {
        _launchBoarders();
      }
    }

    // RECALL button — bring selected boarders home
    if (Input.mouse.leftPressed) {
      const rc = _recallRect();
      if (Utils.pointInRect(Input.mouse.x, Input.mouse.y, rc.x, rc.y, rc.w, rc.h)) {
        _recallBoarders();
      }
    }

    // CLOAK hotkey. The button itself now lives ON the cloak module in
    // the bottom power bar (FTL style) — see _activateCloak / the
    // sysActivateIndex zone in renderer._drawPowerBar.
    if (Input.isPressed('KeyC')) {
      const cl = _playerShip?.getSystem('cloaking');
      if (cl) _activateCloak(cl);
    }

    // EJECT button — only drawn when there is a pod to fire.
    if (Input.mouse.leftPressed && _podSeconds() && !_evacRunning()) {
      const pb = _podRect();
      if (Utils.pointInRect(Input.mouse.x, Input.mouse.y, pb.x, pb.y, pb.w, pb.h)) {
        _pressConsumed = true;
        _startEvac();
      }
    }

    // Retreat button (power pips & buttons are handled in _crewMouseUpdate)
    if (Input.mouse.leftPressed) {
      const rb = _retreatRect();
      if (Utils.pointInRect(Input.mouse.x, Input.mouse.y, rb.x, rb.y, rb.w, rb.h)) {
        // BOARD / RECALL / RETREAT are UI buttons, not points in space.
        // Without this the SAME press also reached _crewClickResolve,
        // landed on no room, and cleared the selection — so pressing
        // BOARD dropped the very crew it had just sent.
        _pressConsumed = true;
        if (_canRetreat()) {
          CombatManager.initiateRetreat(1);
          UI.notify('FTL jump initiated…', 'warn');
        }
      }
    }
    if (Input.isPressed('KeyR')) {
      if (_canRetreat()) {
        CombatManager.initiateRetreat(1);
        UI.notify('FTL jump initiated…', 'warn');
      }
    }

    // Press/drag/release: UI buttons, doors, rubber-band crew
    // selection and group movement (Windows/FTL style)
    _crewMouseUpdate();


    // Outcomes
    // ── Boss phase machine ──
    if (BossManager.isActive) {
      const bres = BossManager.update(0);
      if (bres === 'next_phase') {
        CombatManager.end();
        UI.notify(`MOTHERSHIP — PHASE ${BossManager.phase + 2}`, 'alert');
        _enemyShip = BossManager.nextPhase(850, 120);
        _combatTimer = 0; _combatFired = false;
        CombatManager.begin(_playerShip, _enemyShip, 'boss');
        Audio.sfx.bossWarning();
        return;
      }
      if (bres === 'defeated') {
        // Contract complete — fly home and dock.
        _finishContract();
        CombatManager.end();
        _enemyShip = null;
        return;
      }
    }

    if (CombatManager.isVictory()) {
      _combatTimer += dt;
      if (!_combatFired) {
        _combatFired = true;
        _recoverBoarders();   // emergency teleport off the dying hull
        _creditCrew('wins');
        _onWin();
        UI.notify('Enemy destroyed — repair, then JUMP when ready', 'good');
      }
      // Player decides when to leave: SPACE or JUMP button.
      // Crew keep repairing, shields recharge in the meantime.
      const W = Renderer.getWidth();
      const jumpHit = Input.mouse.leftPressed &&
        Utils.pointInRect(Input.mouse.x, Input.mouse.y, W/2 - 80, 90, 160, 40);
      if (_combatTimer > 1.0 && (Input.isPressed('Space') || jumpHit)) {
        CombatManager.end(); _enemyShip = null; _selectedWeapon = null;
        Captain?.setEnemy?.(null);
        /* WINNING IS AN EXIT TOO (update40). Every other way out of a
           fight cleared the nebula's −2 reactor penalty; this one did
           not, so a won ambush left you sitting on the map with the
           medbay and life support starved until the next jump. */
        _playerShip.reactor.penalty = 0; _nebulaCombat = false;
        _clearWreckMode();
        _saveShip(); STATE = 'map'; Audio.playMusic('explore');
      }
    }
    /* The pod counts down WHILE the fight goes on — that is the whole
       tension of it, and it is why this sits above the defeat check:
       a countdown that finishes on the same frame the hull dies gets
       him out, and one that does not, does not. */
    _tickEvac(dt);
    // The pod finishing ENDS the run — do not carry on updating a
    // fight that no longer has a ship in it.
    if (STATE !== 'combat') return;

    if (CombatManager.isDefeat()) { _onLose(); return; }

    // Total crew wipe — count boarders too, so a full-crew boarding
    // action doesn't false-trigger game over while they're in transit
    // or fighting aboard the enemy.
    if (_playerCrewAliveCount() === 0) {
      UI.notify('All crew lost…', 'alert');
      _onLose();
      return;
    }
    if (CombatManager.isFled()) {
      _sosFightPending = false;   // ran away from the scavengers, no prize
      _creditCrew('escapes');
      _recoverBoarders();
      CombatManager.end(); _enemyShip = null; _saveShip();
      _playerShip.reactor.penalty = 0; _nebulaCombat = false;
      _clearWreckMode();          // see the comment on _clearWreckMode
      UI.notify('Escaped!', 'good'); STATE = 'map'; Audio.playMusic('explore');
      return;
    }
    // The ENEMY completed their escape — they jump out, no loot.
    if (CombatManager.isEnemyFled()) {
      _sosFightPending = false;   // they jumped out with their tanks
      _recoverBoarders();
      CombatManager.end(); _enemyShip = null; _saveShip();
      _playerShip.reactor.penalty = 0; _nebulaCombat = false;
      _clearWreckMode();
      UI.notify('Enemy ship ESCAPED — no salvage…', 'warn');
      STATE = 'map'; Audio.playMusic('explore');
      return;
    }
    // One-shot alert the moment they start spooling their drive
    if (CombatManager.consumeEscapeNotice()) {
      UI.notify('⚠ ENEMY IS TRYING TO ESCAPE — kill their cockpit or engines!', 'alert');
      Audio.sfx.bossWarning?.();
    }
  }

  /** The EJECT button and its countdown, drawn only when relevant. */
  function _drawEvac(ctx) {
    const secs = _podSeconds();
    if (!secs && !_evacRunning()) return;
    const r = _podRect();
    if (_evacRunning()) {
      const frac = Utils.clamp(_evacT / (_evacSecs || 1), 0, 1);
      ctx.fillStyle = 'rgba(40,10,14,0.9)';
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,45,68,0.45)';
      ctx.fillRect(r.x + 1, r.y + 1, (r.w - 2) * frac, r.h - 2);
      ctx.strokeStyle = '#ff2d44'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 4); ctx.stroke();
      ctx.fillStyle = '#ffd7d7';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`KAPSUŁA ${Math.ceil(_evacT)} s`, r.x + r.w / 2, r.y + 18);
      ctx.textAlign = 'left';
      return;
    }
    const hot = Utils.pointInRect(Input.mouse.x, Input.mouse.y, r.x, r.y, r.w, r.h);
    ctx.fillStyle = hot ? 'rgba(255,45,68,0.20)' : 'rgba(13,17,32,0.9)';
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
    ctx.strokeStyle = '#ff8adf'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 4); ctx.stroke();
    ctx.fillStyle = '#ff8adf';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`KAPSUŁA ${secs} s`, r.x + r.w / 2, r.y + 18);
    ctx.textAlign = 'left';
  }

  function _drawCombat(ctx) {
    Renderer.drawBackground(_prevTime * 0.008);
    // (crew selection visuals drawn after ships, see below)

    // Nebula backdrop — drifting violet clouds behind the ships
    if (_nebulaCombat) Renderer.drawNebula(ctx, _prevTime * 0.001);

    if (_playerShip) _playerShip.draw(ctx);
    if (_enemyShip && !_enemyShip.destroyed) _enemyShip.draw(ctx);
    if (_boardingParty) _drawParty(ctx, _boardingParty);
    if (_enemyParty)    _drawParty(ctx, _enemyParty);
    _drawCrewSelection(ctx);

    // Nebula haze in front — the battle feels buried in the cloud
    if (_nebulaCombat) {
      ctx.fillStyle = 'rgba(140,60,200,0.07)';
      ctx.fillRect(0, 0, Renderer.getWidth(), Renderer.getHeight());
    }

    // Victory: JUMP button (player leaves when ready)
    // (Boss phase machine moved to _updateCombat — it used to race
    //  the victory screen here in draw, which looked like a restart.)

    if (CombatManager.isVictory()) {
      const W = Renderer.getWidth();
      const hover = Utils.pointInRect(Input.mouse.x, Input.mouse.y, W/2 - 80, 90, 160, 40);
      ctx.fillStyle = hover ? 'rgba(26,255,140,0.3)' : 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(W/2 - 80, 90, 160, 40, 5); ctx.fill();
      ctx.strokeStyle = '#1aff8c'; ctx.lineWidth = hover ? 2 : 1.5; ctx.stroke();
      ctx.fillStyle = '#1aff8c';
      ctx.font = '14px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('JUMP [SPACE]', W/2, 115);
    }
    CombatManager.draw(ctx);
    CombatManager.drawBeams(ctx);
    Particles.draw(ctx, 1);
    Renderer.drawHUD({ playerShip: _playerShip, enemyShip: _enemyShip , nebula: _nebulaCombat });

    // Retreat button (top right)
    {
      const W = Renderer.getWidth();
      // BOARD button (left of retreat) — needs a live selection
      const canBoard = _hasCaptain() && _enemyShip && !_boardingParty &&
        UI.getSelectedCrewAll().some(c => c.alive);
      const bb = { x: W / 2 - 210, y: 42, w: 136, h: 26 };
      ctx.fillStyle = 'rgba(13,17,32,0.85)';
      ctx.beginPath(); ctx.roundRect(bb.x, bb.y, bb.w, bb.h, 4); ctx.fill();
      ctx.strokeStyle = canBoard ? '#ff2d44' : '#333c50'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bb.x, bb.y, bb.w, bb.h, 4); ctx.stroke();
      ctx.fillStyle = canBoard ? '#ff2d44' : '#4a6080';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      const bn = UI.getSelectedCrewAll().filter(c => c.alive).length;
      let boardLabel = _hasCaptain()
        ? `⚔ BOARD${bn ? ' (' + Math.min(bn, 3) + ')' : ''}`
        : '⚔ BOARD — BRAK KAPITANA';
      if (_boardingParty) {
        boardLabel = _boardingParty.doorBroken
          ? 'BOARDING…'
          : `${_boardingParty.recall ? 'RETURN' : 'POD'} ${Math.round(Utils.clamp(_boardingParty.breachT / _boardingParty.breachNeed, 0, 1) * 100)}%`;
      }
      ctx.fillText(boardLabel, bb.x + bb.w / 2, bb.y + 17);

      // RECALL button — bring selected boarders on the enemy hull home
      {
        const boardedSel = _enemyShip ? UI.getSelectedCrewAll()
          .filter(c => c.alive && c.isPlayer && _enemyShip.crew.includes(c)) : [];
        const canRecall = _hasCaptain() && boardedSel.length > 0 && !_boardingParty;
        const rc = _recallRect();
        ctx.fillStyle = 'rgba(13,17,32,0.85)';
        ctx.beginPath(); ctx.roundRect(rc.x, rc.y, rc.w, rc.h, 4); ctx.fill();
        ctx.strokeStyle = canRecall ? '#4db8ff' : '#333c50'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(rc.x, rc.y, rc.w, rc.h, 4); ctx.stroke();
        ctx.fillStyle = canRecall ? '#4db8ff' : '#4a6080';
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`⚓ RECALL${boardedSel.length ? ' (' + boardedSel.length + ')' : ''}`,
          rc.x + rc.w / 2, rc.y + 17);
      }

      // (The cloak control moved onto its module in the bottom power
      //  bar — renderer._drawPowerBar draws the ring + timer there.)

      _drawEvac(ctx);

      const rb = _retreatRect();
      const prog = CombatManager.retreatProgress;
      ctx.fillStyle = 'rgba(13,17,32,0.85)';
      ctx.beginPath(); ctx.roundRect(rb.x, rb.y, rb.w, rb.h, 4); ctx.fill();
      if (prog > 0) {   // spool-up fill
        ctx.fillStyle = 'rgba(255,124,32,0.35)';
        ctx.beginPath(); ctx.roundRect(rb.x, rb.y, rb.w * prog, rb.h, 4); ctx.fill();
      }
      const retreatCol = _hasCaptain() ? '#ff7c20' : '#4a6080';
      ctx.strokeStyle = _hasCaptain() ? '#ff7c20' : '#333c50'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(rb.x, rb.y, rb.w, rb.h, 4); ctx.stroke();
      ctx.fillStyle = retreatCol;
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(!_hasCaptain() ? 'ODWRÓT — BRAK KAPITANA'
                   : prog > 0 ? `JUMPING ${Math.round(prog * 100)}%` : 'RETREAT [R]',
                   rb.x + rb.w / 2, rb.y + 17);
    }

    // Enemy escape progress — big red warning bar under their readout.
    // Never for a dead hull: the marker used to hang around after we
    // shot the runner down.
    if (_enemyShip && CombatManager.enemyEscapeActive &&
        !_enemyShip.destroyed && _enemyShip.hull > 0 &&
        CombatManager.inProgress()) {
      // `W` is declared inside the button block ABOVE, not at this
      // scope. Reading it here threw a ReferenceError straight out of
      // _drawCombat on every frame the enemy was spooling its drive —
      // the whole frame died, which is what the freezes looked like.
      const W  = Renderer.getWidth();
      const ep = CombatManager.enemyEscapeProgress;
      const ex = W - 320, ey = 84, ew = 300;
      ctx.fillStyle = 'rgba(13,17,32,0.92)';
      ctx.beginPath(); ctx.roundRect(ex, ey, ew, 20, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,45,68,0.5)';
      ctx.beginPath(); ctx.roundRect(ex, ey, ew * ep, 20, 4); ctx.fill();
      ctx.strokeStyle = '#ff2d44'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(ex, ey, ew, 20, 4); ctx.stroke();
      ctx.fillStyle = '#ff2d44';
      ctx.font = 'bold 11px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ ENEMY ESCAPING ${Math.round(ep * 100)}%`, ex + ew / 2, ey + 14);

      // …and a hard-to-miss blinking marker ON the enemy hull itself,
      // with the seconds left. The bar alone was easy to overlook while
      // you were busy managing the ship.
      const b = _enemyShip.roomBounds();
      const mx2 = b.x + b.w / 2;
      const my2 = b.y - 46;
      const pulse = 0.55 + 0.45 * Math.sin((performance.now() % 100000) * 0.012);
      const left = Math.max(0, Math.ceil((1 - ep) * (CombatManager.ENEMY_ESCAPE_TIME ?? 11)));
      ctx.save();
      ctx.globalAlpha = pulse;
      // warning triangle
      ctx.beginPath();
      ctx.moveTo(mx2, my2 - 16);
      ctx.lineTo(mx2 + 16, my2 + 10);
      ctx.lineTo(mx2 - 16, my2 + 10);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,45,68,0.28)';
      ctx.fill();
      ctx.strokeStyle = '#ff2d44'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = '#ff2d44';
      ctx.font = 'bold 15px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('!', mx2, my2 + 7);
      ctx.globalAlpha = 1;
      ctx.font = 'bold 12px Share Tech Mono, monospace';
      ctx.fillText(`FTL SPOOLING — ${left}s`, mx2, my2 + 28);
      ctx.restore();
    }

    // Targeting mode — highlight enemy rooms
    if (_selectedWeapon && _enemyShip) {
      ctx.save();
      _enemyShip.rooms.forEach(r => {
        const hover = Utils.pointInRect(Input.mouse.x, Input.mouse.y, r.x, r.y, r.w, r.h);
        ctx.strokeStyle = hover ? '#ff2d44' : 'rgba(255,45,68,0.4)';
        ctx.lineWidth = hover ? 3 : 1.5;
        ctx.setLineDash(hover ? [] : [5, 4]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        if (hover) {
          ctx.fillStyle = 'rgba(255,45,68,0.15)';
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
      });
      ctx.setLineDash([]);
      // Crosshair at cursor
      ctx.strokeStyle = '#ff2d44';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(Input.mouse.x, Input.mouse.y, 10, 0, Math.PI*2);
      ctx.moveTo(Input.mouse.x - 15, Input.mouse.y);
      ctx.lineTo(Input.mouse.x + 15, Input.mouse.y);
      ctx.moveTo(Input.mouse.x, Input.mouse.y - 15);
      ctx.lineTo(Input.mouse.x, Input.mouse.y + 15);
      ctx.stroke();
      ctx.restore();
    }

    if (CombatManager.state === 'retreating') {
      Renderer.drawRetreatBar(CombatManager._retreatTimer / 3.0);
    }
  }

  // ── EVENT ─────────────────────────────────────────────────
  function _drawEvent(ctx) {
    Renderer.drawBackground(0);
    if (!_event) return;
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    const EW = 480, EH = 260, ex = W/2-EW/2, ey = H/2-EH/2;

    ctx.fillStyle = 'rgba(13,17,32,0.96)';
    ctx.beginPath(); ctx.roundRect(ex,ey,EW,EH,8); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#4db8ff'; ctx.font = '15px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(_event.title, ex+20, ey+30);

    ctx.fillStyle = '#c8d8f0'; ctx.font = '12px Share Tech Mono, monospace';
    let ty = ey+55, words = _event.text.split(' '), line = '';
    words.forEach(w => {
      const test = line + w + ' ';
      if (ctx.measureText(test).width > EW-40) { ctx.fillText(line, ex+20, ty); ty+=14; line=w+' '; }
      else line = test;
    });
    if (line) ctx.fillText(line, ex+20, ty);

    _event.choices.forEach((c, i) => {
      const bx=ex+20, by=ey+160+i*40, bw=EW-40, bh=32;
      const hover = Utils.pointInRect(Input.mouse.x, Input.mouse.y, bx, by, bw, bh);
      ctx.fillStyle = hover ? 'rgba(26,140,255,0.3)' : 'rgba(20,30,50,0.9)';
      ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,4); ctx.fill();
      ctx.strokeStyle = hover ? '#4db8ff' : '#1e2d4a'; ctx.lineWidth=1; ctx.stroke();
      ctx.fillStyle = hover ? '#4db8ff' : '#c8d8f0';
      ctx.font = '12px Share Tech Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText(c.label, bx+12, by+20);

      if (Input.mouse.leftPressed && hover) {
        Audio.sfx.uiClick();
        _resolveEvent(i);
      }
    });
  }

  function _resolveEvent(idx) {
    if (!_event) return;
    const result = _event.choices[idx]?.result ?? {};
    const run = Save.getRun();
    if (!run) { _event = null; STATE = 'map'; return; }

    /* ── THE DECISION IS SCORED ONCE, HERE (update50) ────────
     *
     * Every karma-bearing choice in the game routes through this one
     * function, so this is the only place that has to be right about
     * "jedna decyzja nalicza wynik raz". A karma value on a choice
     * that ALSO resumes combat or opens another screen is still paid
     * exactly here, before any of that happens.
     *
     * A run without a captain moves nothing: karma is personal to a
     * man, and the ones sitting in the mess did not make this call. */
    if (result.karma && _captain && typeof Captain !== 'undefined') {
      const r = Captain.shift(_captain, result.karma);
      if (r) {
        const dir = result.karma > 0 ? 'good' : 'warn';
        let msg = `${_captain.name}: karma ${r.from} → ${r.to}`;
        if (r.killed) msg += ` — ${r.killed} chip(ów) przestało działać`;
        else if (r.wallMoved) msg += ' — blokada CPU się przesunęła';
        UI.notify(msg, dir);
        Base.saveCaptain?.(_captain);
      }
    }

    if (result.scrap) {
      // The table declares INCLUSIVE ranges — see Utils.randIn.
      const amt = Array.isArray(result.scrap) ? Utils.randIn(result.scrap[0], result.scrap[1]) : result.scrap;
      Save.updateRun({ scrap: Math.max(0, run.scrap + amt) });
      UI.notify((amt>=0?'+':'')+`${amt} CC`, amt>=0?'good':'warn');
    }
    if (result.fuel) {
      const amt = Array.isArray(result.fuel)
        ? Utils.randIn(result.fuel[0], result.fuel[1]) : result.fuel;
      if (amt < 0) {
        const burned = _burnFuel(-amt);
        UI.notify(`−${burned} He2`, 'warn');
      } else {
        const r = _addFuel(amt);
        UI.notify(_fuelGainMessage(r), r.spilled ? 'warn' : 'good');
      }
    }
    if (result.missiles) {
      const amt = Array.isArray(result.missiles) ? Utils.randIn(result.missiles[0], result.missiles[1]) : result.missiles;
      const r = _addMissiles(amt);
      UI.notify(r.spilled
        ? `+${r.loaded} missiles — ${r.spilled} left behind, no room in the hold`
        : `+${r.loaded} missiles`, r.spilled ? 'warn' : 'good');
    }
    if (result.crew && _playerShip && _playerShip.crew.length < 8) {
      const c = new CrewMember({});
      _playerShip.addCrew(c);
      UI.notify(`${c.name} joined!`, 'good');
    }
    /* AN ANIMAL COMES ABOARD (update45). One per hull — a second cat
       would only halve the first one's work — and it goes straight into
       the crew list, because that is where everything physically aboard
       lives. If the offer had a price and it cannot be paid, nothing
       happens at all rather than half-happening. */
    if (result.pet && _playerShip && typeof makeCat === 'function') {
      const already = _playerShip.crew.some(c => c.isPet && !c.dead);
      const price   = result.cost ?? 0;
      const run     = Save.getRun();
      if (already) {
        UI.notify('You already have an animal aboard — one is the limit.', 'warn');
      } else if (price > 0 && (run?.scrap ?? 0) < price) {
        UI.notify(`Not enough CC — ${price} asked.`, 'warn');
      } else {
        if (price > 0) Save.updateRun({ scrap: (run.scrap ?? 0) - price });
        const cat = makeCat();
        _playerShip.addCrew(cat);
        UI.notify(`${cat.name} is aboard — keep the rations coming.`, 'good');
      }
    }
    /* ── MODULE OFFERS (update38) ──────────────────────────────
     * `system_upgrade`, `cost` and `system_damage` were written into
     * the event table and then never read by anything: accepting the
     * field medic's offer charged nothing, upgraded nothing, and was
     * offered to ships with no medbay at all. Both are handled here
     * now, and the offer itself is filtered before it is ever shown —
     * see eventFits() in map.js.
     */
    if (result.system_upgrade && _playerShip) {
      const sys  = _playerShip.getSystem(result.system_upgrade);
      const cost = result.cost ?? 0;
      const have = Save.getRun()?.scrap ?? 0;
      const max  = sys?.def?.maxLevel ?? 8;
      if (!sys) {
        // Belt and braces: the filter should have kept this off screen.
        UI.notify('Nothing aboard for them to work on — the offer lapses.', 'warn');
      } else if (cost > have) {
        UI.notify(`Not enough CC — they wanted ${cost}.`, 'warn');
      } else if (sys.level >= max) {
        UI.notify(`${sys.label} is already at maximum.`, 'warn');
      } else {
        sys.level += 1;
        sys.desiredPower = Math.max(sys.desiredPower ?? 0, 1);
        if (cost) Save.updateRun({ scrap: have - cost });
        _saveShip();
        UI.notify(`${sys.label} upgraded to level ${sys.level}`
                + (cost ? ` (−${cost} CC)` : ''), 'good');
      }
    }
    if (result.system_damage && _playerShip) {
      // A chance — not a certainty — that the anomaly burns something out.
      const hurtable = _playerShip.systems.filter(s =>
        s.type !== 'reactor' && s.damagedLevels < s.level);
      if (hurtable.length && Math.random() < result.system_damage) {
        const sys = Utils.pick(hurtable);
        sys.damageLevel(1);
        _saveShip();
        UI.notify(`${sys.label} burned out a level!`, 'alert');
      }
    }
    if (result.risk === 'crew_damage' && _playerShip?.crew.length > 0) {
      const target = Utils.pick(_playerShip.crew.filter(c=>!c.dead));
      if (target) { const dmg=Utils.randInt(10,40); target.takeDamage(dmg,'boarding'); UI.notify(`${target.name} took ${dmg} dmg!`,'alert'); }
    }
    if (result.loseCrew && _playerShip && _playerShip.crew.length > 1) {
      const victim = Utils.pick(_playerShip.crew.filter(c => !c.dead));
      if (victim) {
        _playerShip.crew = _playerShip.crew.filter(c => c !== victim);
        // addToGraveyard takes the CREW MEMBER, not a name: it deep-clones
        // `crewMember.skills`, and deepClone(undefined) throws, so handing
        // somebody over as tribute crashed the event mid-resolution.
        victim.killedBy = 'handed over as tribute';
        Save.addToGraveyard?.(victim);
        UI.notify(`${victim.name} was handed over…`, 'alert');
      }
    }
    if (result.weaponReward && _playerShip) {
      _playerShip.weaponCargo.push(result.weaponReward);
      UI.notify('Weapon added to cargo — install it at a station', 'good');
    }
    if (result.startPending && _pendingCombat) {
      const pc = _pendingCombat; _pendingCombat = null;
      _event = null;
      _startCombat(pc.difficulty, pc.nebula);
      return;
    }
    if (result.resumeCombat) {
      _event = null;
      STATE = 'combat';
      // No mercy given — a cornered crew storms YOUR ship instead
      if (_enemyShip && !_counterBoarded && _enemyShip.crew.length > 2 &&
          Math.random() < 0.6) {
        _counterBoarded = true;
        const troops = _enemyShip.crew.filter(c => c.alive).slice(-2);
        troops.forEach(c => {
          _enemyShip.crew = _enemyShip.crew.filter(k => k !== c);
          c._waypoints = []; c.task = TASK.IDLE;
        });
        if (troops.length) {
          // give them back for the muster walk — _makeParty removes
          // them from the roster only when they step outside
          troops.forEach(c => { if (!_enemyShip.crew.includes(c)) _enemyShip.crew.push(c); });
          _enemyParty = _makeParty(_enemyShip, _playerShip, troops);
          if (_enemyParty) UI.notify('⚠ Enemy assault team is heading for their airlock!', 'alert');
        }
      }
      return;
    }
    if (result.acceptSurrender) {
      _event = null;
      _endCombatPeacefully();
      return;
    }
    // ── Distress beacon outcomes ─────────────────────────────
    if (result.sosRetry) {          // couldn't afford it — beacon stays up
      _event = null;
      _maybeSOS(true);
      return;
    }
    if (result.sosTradeWeapon) {
      _event = null;
      const gun = _playerShip?.weaponCargo?.shift();
      const gain = gun ? 5 : 2;
      const r = _addFuel(gain);
      UI.notify((gun ? `Traded a spare weapon for ` : `They took pity: +`)
              + `${r.loaded} He2` + (r.spilled ? ` — ${r.spilled} would not fit` : ''),
              r.spilled ? 'warn' : 'good');
      STATE = 'map';
      return;
    }
    if (result.sosFight) {
      _event = null;
      // Win the fight and you take their tanks (handled in _onWin plus
      // this guaranteed top-up, so the fight is always worth it).
      _sosFightPending = true;
      _startCombat(_difficulty(), false);
      return;
    }
    if (result.sosBeg) {
      _event = null;
      // Always yields SOMETHING — this branch is what stops an empty
      // tank from ending the run outright.
      const alms = Utils.randIn(1, 2);        // really 1 OR 2 now
      const toll = Math.min(run.scrap, Utils.randIn(0, 10));
      const r = _addFuel(alms);
      Save.updateRun({ scrap: Math.max(0, run.scrap - toll) });
      UI.notify(toll > 0
        ? `They spare ${r.loaded} He2 — and help themselves to ${toll} CC`
        : `They spare ${r.loaded} He2. Barely enough.`, toll > 0 ? 'warn' : 'good');
      STATE = 'map';
      return;
    }
    if (result.destroyDerelict) {
      _event = null;
      STATE = 'combat';
      if (_enemyShip) {
        const sector = Save.getRun()?.sector ?? 1;
        const bonus = Utils.randInt(25, 40 + sector * 8);
        CombatManager.scrapReward = (CombatManager.scrapReward ?? 0) + bonus;
        _enemyShip.hull = 0;
        _enemyShip.destroyed = true;
      }
      UI.notify('Finishing off the wreck for CC…', 'warn');
      return;
    }
    if (result.dockWreck) {
      // A derelict found on the MAP: dock with it, then WALK THROUGH it.
      _event = null;
      const sector = Save.getRun()?.sector ?? 1;
      _beginDocking(sector, {
        seconds: result.seconds ?? 50,
        rich: !!result.rich,
        // The mining barge sets this and nothing ever read it.
        hazard: !!result.hazard,
        title: 'DOCKING WITH THE DERELICT',
      });
      return;
    }
    if (result.searchDerelict) {
      _event = null;
      // Used to be a single dice roll and a line of text. Now you
      // actually go aboard: two holds, a clock, and only so many cells.
      const sector = Save.getRun()?.sector ?? 1;
      _openWreckLoot(sector);
      return;
    }
    if (result.combat) {
      _event = null;
      _startCombat(result.combat === 'easy' ? 'normal' : result.combat, _nebulaCombat);
      return;
    }
    _pendingCombat = null;
    _event = null;
    STATE = 'map';
  }

  /** Enemy surrendered — take the tribute, let them limp away. */
  /* ── MOON RATS ────────────────────────────────────────────
     A heavily loaded hold is a place to hide, and a hold that smells
     of rations is a place worth hiding in. Both halves of the player's
     report are here: the fuller the hold the likelier they are, and
     food makes it likelier still.

     Deliberately a per-JUMP roll rather than a per-frame one: a jump
     is when the ship is open, and it is the one moment the player is
     already reading notifications. */
  const RAT_FILL_FLOOR   = 0.5;   // below half empty, nothing comes aboard
  const RAT_MAX_CHANCE   = 0.22;  // at a completely full hold
  const RAT_FOOD_BONUS   = 0.09;  // per ration pack aboard
  const RAT_FOOD_CAP     = 0.27;
  const RAT_MAX_ABOARD   = 4;

  /** The odds of picking up a stowaway on this jump. Exposed for tests. */
  function _ratChance(hold) {
    if (!hold || !hold.capacity) return 0;
    const fill = hold.usedCells() / hold.capacity;
    if (fill < RAT_FILL_FLOOR) return 0;
    let p = ((fill - RAT_FILL_FLOOR) / (1 - RAT_FILL_FLOOR)) * RAT_MAX_CHANCE;
    const food = hold.items.filter(it => it.def?.tag === 'food' && !it.damaged).length;
    if (food) p += Math.min(RAT_FOOD_CAP, food * RAT_FOOD_BONUS);
    /* A CAT ABOARD IS A DETERRENT, NOT A CURE (update45). It takes
       twelve points off the roll and cannot take it to zero: a hold
       packed to the roof is still a hold packed to the roof, and the
       cat's real job is what it does to the rats that DO get aboard. */
    if (typeof CAT_TUNING !== 'undefined' &&
        _playerShip?.crew?.some(c => c.isPet && !c.dead)) {
      p = Math.max(0, p - CAT_TUNING.RAT_SPAWN_CUT);
    }
    return Utils.clamp(p, 0, 0.6);
  }

  /** Roll for stowaways. Called once per real jump. */
  function _rollForRats() {
    const ship = _playerShip;
    const hold = ship?.cargo;
    if (!ship || !hold) return 0;

    const aboard = ship.crew.filter(c => c.isVermin && !c.dead).length;

    // They eat first. A rat aboard and rations in the hold is a ration
    // pack spoiled — which is the cost of ignoring them, and the reason
    // the smell fades once you have dealt with them.
    if (aboard) {
      const food = hold.items.filter(it => it.def?.tag === 'food' && !it.damaged);
      if (food.length && Math.random() < 0.5) {
        const eaten = Utils.pick(food);
        eaten.damaged = true;
        UI.notify(`Something got into the ${eaten.label}.`, 'warn');
      }
    }

    if (aboard >= RAT_MAX_ABOARD) return 0;
    if (Math.random() >= _ratChance(hold)) return 0;

    const n = Math.min(Utils.randInt(1, 3), RAT_MAX_ABOARD - aboard);   // 1..2
    const rooms = ship.rooms.filter(r => r.system).length
                ? ship.rooms.filter(r => r.system) : ship.rooms;
    if (!rooms.length) return 0;
    const rats = makeRats(n);
    rats.forEach((rat, i) => {
      const room = rooms[(i + Utils.randInt(0, rooms.length)) % rooms.length];
      rat.x = room.cx + Utils.randFloat(-16, 16);
      rat.y = ship.floorWalkY(room.floor, room.cy);
      rat.roomId = room.id; rat.homeRoomId = room.id;
      ship.addCrew(rat, true);
    });
    UI.notify(n > 1
      ? `Moon rats in the hold — ${n} of them, and they are already loose.`
      : 'Something is moving in the hold. A moon rat came aboard with the cargo.',
      'alert');
    Audio.sfx.bossWarning?.();
    return n;
  }

  /**
   * One battle's worth of the void-spider virus.
   *
   *   bitten  →  a few fights  →  the host dies and leaves an egg case
   *   egg     →  a few fights  →  it splits and 1-3 spiders are loose
   *
   * The only way off that track is a research post's quarantine ward.
   */
  function _tickInfections() {
    const ship = _playerShip;
    if (!ship) return;

    // ── eggs hatch ──
    const eggs = (ship.cargo?.items ?? []).filter(it => it.def.tag === 'egg');
    eggs.forEach(egg => {
      const left = (typeof egg.meta === 'number' ? egg.meta : EGG_FIGHTS_TO_HATCH) - 1;
      egg.meta = left;
      if (left > 0) {
        UI.notify(`Something is moving inside the egg case (${left} to go)…`, 'warn');
        return;
      }
      ship.cargo.remove(egg);
      const n = Utils.randInt(1, 4);          // 1..3
      const rooms = ship.rooms.filter(r => r.system);
      makeSpiders(n, 0).forEach((sp, i) => {
        const room = (rooms.length ? rooms : ship.rooms)[i % Math.max(1, rooms.length)];
        sp.x = room.cx + Utils.randFloat(-14, 14);
        sp.y = room.cy + 8;
        sp.roomId = room.id; sp.homeRoomId = room.id;
        ship.addCrew(sp, true);
      });
      UI.notify(`The egg case split open — ${n} spider${n > 1 ? 's' : ''} loose aboard!`, 'alert');
      Audio.sfx.bossWarning?.();
    });

    // ── the infected get worse ──
    ship.crew.filter(c => c.isPlayer && c.virus && !c.dead).forEach(c => {
      c.virusFights++;
      const left = VIRUS_FIGHTS_TO_DEATH - c.virusFights;
      if (left > 0) {
        UI.notify(`${c.name} is getting worse — ${left} fight${left > 1 ? 's' : ''} `
                + 'before it kills him. A research post can still cure it.', 'warn');
        return;
      }
      c.killOutright('void-spider virus');
      const egg = ship.cargo?.add('spider_egg', EGG_FIGHTS_TO_HATCH);
      UI.notify(egg
        ? `${c.name} did not make it. There is an egg case where he fell.`
        : `${c.name} did not make it — and there was no room in the hold for what came out.`,
        'alert');
    });
  }

  /**
   * Leaving a derelict, by ANY door — put the mode back.
   *
   * This used to be called from exactly one place (_endCombatPeacefully),
   * so retreating from a hulk left `_wreckMode` armed with the old
   * `_wreckLoot` grid still loaded. The next time you wiped an enemy
   * crew, the "the nest is dead, take the hold" check fired instead of
   * the derelict offer: it handed you the PREVIOUS wreck's hold for
   * free, skipped _onWin entirely (no CC, no weapon drop) and deleted a
   * live enemy ship mid-fight. It survived _onLose too, so it could
   * carry into a different contract.
   */
  function _clearWreckMode() {
    _wreckMode = false; _wreckLoot = null; _wreckLooted = false;
  }

  function _endCombatPeacefully() {
    _recoverBoarders();
    CombatManager.end();
    if (_enemyShip) Particles.floatText(
      _enemyShip.worldX + 150, _enemyShip.worldY + 80, 'SURRENDERED', '#1aff8c', 14);
    _enemyShip = null;
    _playerShip.reactor.penalty = 0;
    _nebulaCombat = false;
    // Nobody threw a punch — nobody learns to punch. (See combat.js.)
    _tickInfections();
    _clearWreckMode();
    STATE = 'map';
    Audio.playMusic('explore');
  }

  // ── CARGO / LOOT ──────────────────────────────────────────

  let _lootReturn = 'map';   // where to go when the loot screen closes

  /**
   * Open a container and use it. Returns { ok, message, consumed } —
   * `consumed:false` means the item survives with fewer units in it,
   * which is how a 10-dose medkit works.
   */
  function _unpackCargo(item) {
    const run = Save.getRun();
    const k   = item.def.kind;

    if (k === 'fuel') {
      /* THERE IS NO TANK ANY MORE (update39). He2 works exactly like
         warheads: the drive feeds straight out of the cells sitting in
         the hold. Pouring a canister into a counter was the last place
         a cargo item turned into an invisible number, and it meant you
         could jump with an empty hold. */
      return { ok: false, message: 'The drive feeds straight from these cells' };
    }

    if (k === 'missiles') {
      // Nothing to open — the launchers feed from the rack where it lies.
      return { ok: false, message: 'The launchers already feed from this rack' };
    }

    if (k === 'scan') {
      /* A SURVEY PROBE (update39). You arrive in a sector able to see
         the jump in front of you and a smudge one step past it; this
         is what buys you the rest of the map. One shot, and the sector
         you are IN is the one it resolves. */
      if (!_sectorMap) return { ok: false, message: 'Nothing to survey out here' };
      if (!_sectorMap.revealAll()) {
        return { ok: false, message: 'This sector is already surveyed' };
      }
      _saveShip();
      return { ok: true, consumed: true,
               message: `Probe away — Sector ${Save.getRun()?.sector ?? '?'} resolves` };
    }

    if (k === 'heal') {
      // YOUR medkit, YOUR people (update42). Unfiltered, this picked
      // the most wounded body aboard — which after a boarding fight is
      // usually the enemy who is bleeding on your floor, or a rat.
      const hurt = _playerShip?.crew
        .filter(c => c.isPlayer && !c.dead && c.hp < c.maxHp)
        .sort((a, b) => a.hp - b.hp)[0];
      if (!hurt) return { ok: false, message: 'Nobody needs patching up' };
      const dose = item.def.healPerDose ?? item.def.amount ?? 25;
      hurt.heal(dose);
      if (item.isStack) item.qty -= 1;
      const left = item.isStack ? item.qty : 0;
      return { ok: true, consumed: !item.isStack || left <= 0,
               message: `${hurt.name} patched up`
                      + (item.isStack ? ` — ${left} dose(s) left` : '') };
    }

    if (k === 'weapon') {
      const wk = item.meta;
      if (!wk || !_playerShip) return { ok: false, message: 'The crate is empty' };
      // A gun is either BOLTED ON or BOXED — never floating in an
      // abstract rack. Unboxing therefore means FITTING it, and that
      // needs a free weapon mount.
      let slot = -1;
      for (let i = 0; i < _playerShip.weaponSlots; i++) {
        if (!_playerShip.weapons[i]) { slot = i; break; }
      }
      if (slot === -1) {
        return { ok: false,
                 message: 'Every weapon mount is full — it stays in its crate' };
      }
      if (!_playerShip.installWeapon(wk, slot)) {
        return { ok: false, message: 'That mount will not take it' };
      }
      // Take the crate out HERE, not only in the loot screen — any other
      // caller would otherwise fit the gun and leave the crate behind.
      _playerShip.cargo?.remove(item);
      const label = (typeof WEAPON_DEFS !== 'undefined' && WEAPON_DEFS[wk]?.label) || 'Gun';
      return { ok: true, consumed: true,
               message: `${label} unboxed and fitted to mount ${slot + 1}` };
    }
    return { ok: false, message: 'Nothing to open — sell it instead' };
  }

  /**
   * Keep the HUD's missile figure equal to what is actually in the racks.
   * Writes ONLY when the two disagree — Save.updateRun hits localStorage,
   * so this is safe to call every frame as a backstop.
   */
  function _syncAmmo() {
    if (!_playerShip?.cargo) return;
    const run = Save.getRun();
    if (!run) return;
    const real = _playerShip.missileCount();
    if (run.missiles !== real) Save.updateRun({ missiles: real });
  }

  /**
   * The same, for He2 (update39). `run.fuel` is a MIRROR of the cells
   * in the hold now, kept only so the HUD, the shop and old saves keep
   * working — never the source of truth.
   */
  function _syncFuel() {
    if (!_playerShip?.cargo) return;
    const run = Save.getRun();
    if (!run) return;
    const real = _playerShip.fuelCount();
    if (run.fuel !== real) Save.updateRun({ fuel: real });
  }

  /** He2 aboard right now. Falls back to the counter on a hull with no
   *  grid, so nothing can strand a ship that has no hold at all. */
  function _fuelAboard() {
    if (_playerShip?.cargo) return _playerShip.fuelCount();
    return Save.getRun()?.fuel ?? 0;
  }

  /**
   * Burn He2 out of the cells. Returns how much was actually drawn —
   * ask for one, get zero, and you did not jump.
   */
  function _burnFuel(n = 1) {
    const hold = _playerShip?.cargo;
    if (!hold) {
      const run = Save.getRun();
      if (!run) return 0;
      const took = Math.min(n, run.fuel);
      Save.updateRun({ fuel: run.fuel - took });
      return took;
    }
    const took = hold.takeStack('fuel', n);
    _syncFuel();
    return took;
  }

  /**
   * Put He2 aboard, in cells. Reports what did NOT fit rather than
   * quietly inflating a counter — same contract as _addMissiles.
   */
  function _addFuel(n) {
    const hold = _playerShip?.cargo;
    if (!hold) {
      const run = Save.getRun();
      if (run) Save.updateRun({ fuel: run.fuel + n });
      return { loaded: n, spilled: 0 };
    }
    // Small bottles first: they slot into the gaps a full hold leaves.
    let left = n;
    for (const key of ['he2_med', 'he2_small', 'he2_large']) {
      if (left <= 0) break;
      left = hold.addStack(key, left);
    }
    _syncFuel();
    return { loaded: n - left, spilled: left };
  }

  /** One line for "+n He2, m left behind". Used by every fuel payout. */
  function _fuelGainMessage(r) {
    return r.spilled
      ? `+${r.loaded} He2 — ${r.spilled} left behind, no room in the hold`
      : `+${r.loaded} He2`;
  }

  /**
   * Put missiles aboard. The hold is a real constraint, so this reports
   * what did NOT fit instead of quietly inflating a counter.
   */
  function _addMissiles(n) {
    const hold = _playerShip?.cargo;
    if (!hold) {
      const run = Save.getRun();
      if (run) Save.updateRun({ missiles: run.missiles + n });
      return { loaded: n, spilled: 0 };
    }
    const left = hold.addStack('missile_rack', n);
    _syncAmmo();
    return { loaded: n - left, spilled: left };
  }

  /**
   * A gun you were GIVEN (a battlefield recovery) arrives in a locker,
   * exactly like a wreck's hold: you have to physically find room for it.
   * Queued rather than opened on the spot, because the fight is still
   * unwinding when the drop is rolled.
   */
  let _pendingLocker = null;
  let _queuedChip    = null;   // a boss chip with nowhere to go yet
  let _evacT         = 0;      // escape-pod countdown, seconds left
  let _evacSecs      = 0;      // what it started at, for the bar

  function _queueWeaponLocker(defKey) { _pendingLocker = defKey; }

  /**
   * A chip the hold could not take, shown as a one-cell locker beside
   * it. Same screen, same rules: he moves it across or he decides what
   * to drop for it. He cannot leave with it unresolved — the reward
   * has to end up somewhere the player chose.
   */
  function _openChipLocker(chipKey) {
    if (typeof LootScreen === 'undefined' || !_playerShip?.cargo) return;
    const probe  = new CargoItem(chipKey);
    const locker = new CargoGrid(Math.max(4, probe.w), Math.max(2, probe.h));
    locker.add(chipKey);
    const back = STATE === 'loot' ? 'map' : STATE;
    _lootReturn = back;
    LootScreen.openLoot(locker, _playerShip.cargo, {
      title: 'NAGRODA — CHIP CPU',
      subtitle: 'zrób miejsce w ładowni · chip montuje się dopiero w bazie',
      leftLabel: 'NAGRODA',
      holdLabel: 'SHIP HOLD',
      takeAllLabel: 'TAKE IT',
      portType: 'general',
      onClose: ({ wreck }) => {
        // Still in the locker? He chose not to take it; say so plainly
        // rather than pretending it went somewhere.
        if (wreck?.items?.length) UI.notify('Chip zostawiony za burtą.', 'warn');
        STATE = back; _beginFade(); _saveShip();
      },
    });
    STATE = 'loot'; _beginFade();
  }

  function _openWeaponLocker(defKey) {
    if (typeof LootScreen === 'undefined' || !_playerShip?.cargo) {
      // No cargo system — fall back to the abstract rack.
      _playerShip?.weaponCargo.push(defKey);
      UI.notify('Weapon recovered → weapon rack', 'good');
      return;
    }
    const crateKey = (typeof cargoCrateForWeapon === 'function')
      ? cargoCrateForWeapon(defKey) : 'gun_crate';
    const probe  = new CargoItem(crateKey);
    const locker = new CargoGrid(Math.max(3, probe.w), Math.max(3, probe.h));
    locker.add(crateKey, defKey);

    const wdef = (typeof WEAPON_DEFS !== 'undefined' && WEAPON_DEFS[defKey]) || {};
    const back = STATE === 'loot' ? 'map' : STATE;
    _lootReturn = back;
    LootScreen.openLoot(locker, _playerShip.cargo, {
      title: 'SALVAGED WEAPON',
      subtitle: 'click to pick up, click to put down · R rotates · anything left in the '
              + 'locker stays on the wreck',
      leftLabel: 'PRIZE LOCKER',
      takeAllLabel: 'TAKE IT',
      doneLabel: 'DONE',
      intro: `${wdef.label ?? 'A gun'} recovered — find room for it.`,
      onUnpack: _unpackCargo,
      onClose: ({ wreck }) => {
        const left = wreck?.items?.length ?? 0;
        if (left) UI.notify('No room — the gun stays behind.', 'warn');
        STATE = back; _beginFade();
        _saveShip();
      },
    });
    STATE = 'loot'; _beginFade();
  }

  // ── DERELICTS: dock, board, clear the nest, strip the hold ──

  let _dockPending = null;   // { sector, seconds, rich, title }
  let _wreckMode   = false;  // the "enemy" is a derelict, not a fight
  let _wreckLoot   = null;   // its hold, generated up front
  let _wreckSecs   = 50;
  let _wreckLooted = false;

  /** Step 1: line up on the hulk. */
  function _beginDocking(sector, opts = {}) {
    if (typeof DockingGame === 'undefined') {   // module missing — skip it
      _startWreckBoarding(sector, opts);
      return;
    }
    _dockPending = { sector, ...opts };
    DockingGame.open({ sector, title: opts.title || 'DOCKING MANOEUVRE' });
    STATE = 'docking'; _beginFade();
  }

  function _updateDocking(dt) {
    const res = DockingGame.update(dt);
    if (!res) return;
    const pend = _dockPending || { sector: 1 };
    _dockPending = null;

    if (res === 'abort') {
      UI.notify('Broke off the approach.', 'warn');
      STATE = 'map'; _beginFade();
      return;
    }

    const out = DOCK_OUTCOMES[res] || DOCK_OUTCOMES.ok;
    if (out.hullDamage && _playerShip) {
      _playerShip.hull = Math.max(1, _playerShip.hull - out.hullDamage);
    }
    // Auto-dock burns He2 out of the cells like any other burn.
    if (out.fuel) _burnFuel(out.fuel);
    UI.notify(out.message, res === 'bad' ? 'warn' : 'good');

    _startWreckBoarding(pend.sector, {
      ...pend,
      seconds: Math.max(20, (pend.seconds ?? 50) + out.bonusSeconds),
    });
  }

  /**
   * Step 2: the derelict is a REAL ship you walk through. It has no guns
   * and no power, but it has a nest in it — so this reuses the whole
   * boarding stack (BOARD, melee, oxygen, RECALL) rather than inventing
   * a second one.
   */
  function _startWreckBoarding(sector, opts = {}) {
    _enemyShip = makeDerelict(sector);
    populateDerelict(_enemyShip, sector);
    _wreckMode   = true;
    _wreckLooted = false;
    _wreckSecs   = opts.seconds ?? 50;
    _wreckLoot   = makeWreckGrid(sector, opts.rich
      ? { cols: 5, rows: 4, tries: Utils.randInt(4, 7 + sector) } : {});

    _playerShip.prechargeShields();
    _playerShip.markCombatStart();
    _surrenderAsked  = true;    // nothing aboard to surrender
    _derelictOffered = true;    // we go straight to the hold, no dialog
    _boardingParty = null; _enemyParty = null;

    CombatManager.begin(_playerShip, _enemyShip, 'normal');
    CombatManager.scrapReward = 0;
    CombatManager.weaponDrop  = null;
    CombatManager.enemyEscapeActive = false;

    STATE = 'combat'; _beginFade();
    _combatTimer = 0; _combatFired = false;
    Audio.playMusic('explore');
    /* NO HEAD COUNT. The sacs are hidden until somebody walks into the
       room with them, so handing the player an exact number on the way
       in gave away the one thing the boarding action is FOR. And the
       air warning is gone with the coin flip that used to decide it —
       a derelict always has one unit of power, and it runs life
       support (see wreck.js makeDerelict).
       NOTHING IS BURNING EITHER (update39) — see wreck.js. */
    UI.notify('Docked. Her hull is cold and the corridors are dark — '
            + 'send a boarding party.', 'alert');
  }

  /** Step 3: the nest is dead — take the hold. */
  function _wreckCleared() {
    _wreckLooted = true;
    _recoverBoarders();
    _tickInfections();
    CombatManager.end();
    const grid = _wreckLoot || makeWreckGrid(Save.getRun()?.sector ?? 1);
    _wreckLoot = null;
    LootScreen.openLoot(grid, _playerShip.cargo, {
      title: 'THE HOLD',
      subtitle: 'the nest is dead · take what fits before she breaks up',
      leftLabel: 'DERELICT HOLD',
      timerLabel: 'HULL BREAKING UP',
      doneLabel: 'CAST OFF',
      seconds: _wreckSecs,
      intro: 'Nest cleared. The hold is yours.',
      onUnpack: _unpackCargo,
      onClose: () => {
        _enemyShip = null;
        _wreckMode = false;
        _playerShip.reactor.penalty = 0;
        STATE = 'map'; _beginFade();
        _saveShip();
      },
    });
    STATE = 'loot'; _beginFade();
  }

  /** Look at (and tidy) your own hold between jumps. */
  function _openHold() {
    if (!_playerShip?.cargo) { UI.notify('No cargo hold on this hull', 'warn'); return; }
    _lootReturn = STATE;
    LootScreen.openHold(_playerShip.cargo, {
      title: 'CARGO HOLD',
      subtitle: 'click to pick up, click again to put down · R rotates · SPLIT halves a stack',
      doneLabel: 'CLOSE',
      onUnpack: _unpackCargo,
      onClose:  () => { STATE = _lootReturn; _beginFade(); _saveShip(); },
    });
    STATE = 'loot'; _beginFade();
  }

  /**
   * Board a dead-but-intact hull and strip its hold.
   * opts.returnTo  — 'combat' (after a fight) or 'map' (a map event)
   * opts.seconds   — clock; opts.hazard shortens it; opts.rich fattens the hold
   */
  function _openWreckLoot(sector, opts = {}) {
    const wreck = makeWreckGrid(sector, opts.rich
      ? { cols: 6, rows: 5, tries: Utils.randInt(8, 12 + sector) }
      : {});

    // A wreck sometimes still has a gun in a crate — the old
    // "jackpot" roll, but now it has to physically fit in your hold.
    if (Math.random() < 0.22) {
      const wk = (typeof randomWeaponDrop === 'function') ? randomWeaponDrop(sector) : null;
      if (wk) wreck.add(cargoCrateForWeapon(wk), wk);
    }

    let intro = 'Salvage team aboard. Take what fits.';
    // The booby trap survives from the old event — it just costs you
    // time on the clock now instead of ending the scene.
    let seconds = opts.seconds ?? 50;
    if (Math.random() < 0.18) {
      const target = _playerShip?.crew.find(c => !c.dead);
      const dmg    = Utils.randInt(8, 18);
      if (target) {
        target.takeDamage(dmg, 'boarding');
        intro = `Booby trap! ${target.name} took ${dmg} — and you are on the clock.`;
        seconds = Math.min(seconds, 32);
      }
    }

    // Survivors still turn up, but they walk aboard before the hold
    // is opened, so this never competes with the salvage itself.
    if (Math.random() < 0.20 && _playerShip && _playerShip.crew.length < 8) {
      const c = new CrewMember({});
      _playerShip.addCrew(c);
      UI.notify(`Found a survivor in the wreck — ${c.name} joins your crew!`, 'good');
    }

    const back = opts.returnTo ?? 'combat';
    _lootReturn = back;
    LootScreen.openLoot(wreck, _playerShip.cargo, {
      title: opts.title || 'BOARDING THE DERELICT',
      subtitle: 'click a crate, click a cell · R rotates · the clock is running',
      leftLabel: 'DERELICT HOLD',
      timerLabel: 'HULL BREAKING UP',
      doneLabel: 'CAST OFF',
      seconds, intro,
      onUnpack: _unpackCargo,
      onClose: () => {
        if (back === 'combat' && _enemyShip) {
          _enemyShip.hull = 0; _enemyShip.destroyed = true;
        }
        STATE = back; _beginFade();
        _saveShip();
      },
    });
    STATE = 'loot'; _beginFade();
  }

  function _updateLoot(dt) {
    if (typeof LootScreen === 'undefined') { STATE = _lootReturn || 'map'; return; }
    LootScreen.update(dt);
  }

  // ── STATION ───────────────────────────────────────────────

  /**
   * Leaving a port is a STATE CHANGE, so it belongs in update, not in
   * draw — where it used to live, one frame's worth of luck away from
   * whether the save happened at all.
   */
  function _updateStation(dt) {
    if (_playerShip) _playerShip.update(dt);
    const stEl = document.getElementById('station-screen');
    if (stEl && !stEl.classList.contains('visible')) {
      /* SAVE ON THE WAY OUT.
       *
       * Everything bought at a port — a welded hull, a cured crewman, a
       * new module, a fitted gun — was applied to the LIVE objects and
       * nothing wrote them to the save. The CC, meanwhile, was spent
       * through Save.updateRun() immediately. So the money always stuck
       * and the goods never did: reload after visiting a science post
       * and the virus you paid 45 CC a head to cure was back, countdown
       * and all. That is the "cured it at the station, still infected in
       * the barracks" report. */
      _saveShip();
      STATE = 'map';
      Audio.playMusic('explore');
    }
  }

  function _drawStation(ctx) {
    Renderer.drawBackground(0);
    Renderer.drawHUD({ playerShip: _playerShip });
    // Station DOM overlay is handled by UI.openStation; leaving it is
    // handled in _updateStation, where a state change belongs.
  }

  // ── OUTCOME ───────────────────────────────────────────────
  function _updateOutcome(dt) {
    _outcomeTimer += dt;
    if (_outcomeTimer > 1.0 && (Input.isPressed('Space') || Input.mouse.leftPressed)) {
      // Straight back to the base — that's where the next contract is
      // fitted out, and where the player sees what survived.
      _playerShip = null; _enemyShip = null; _sectorMap = null;
      _openBase();
    }
  }

  function _drawOutcome(ctx) {
    Renderer.drawBackground(0);
    Renderer.drawOutcome(_outcomeType, _outcomeScrap);
  }

  /** Loud, readable failure. Beats a dead-looking menu every time. */
  function _drawFatal(ctx) {
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    ctx.fillStyle = 'rgba(40,6,10,0.92)';
    ctx.fillRect(0, H / 2 - 70, W, 140);
    ctx.strokeStyle = '#ff2d44'; ctx.lineWidth = 2;
    ctx.strokeRect(0, H / 2 - 70, W, 140);
    ctx.fillStyle = '#ff2d44';
    ctx.font = '20px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SOMETHING IS MISSING', W / 2, H / 2 - 30);
    ctx.fillStyle = '#ffb0b8';
    ctx.font = '13px Share Tech Mono, monospace';
    const words = _fatal.split(' ');
    let line = '', y = H / 2;
    words.forEach(w => {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > W - 120 && line) { ctx.fillText(line, W / 2, y); y += 18; line = w; }
      else line = t;
    });
    if (line) ctx.fillText(line, W / 2, y);
    ctx.fillStyle = '#7a90a8';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.fillText('Press F12 → Console for details.', W / 2, H / 2 + 52);
  }

  // ── PAUSE ─────────────────────────────────────────────────
  function _drawPause(ctx) {
    const W=Renderer.getWidth(), H=Renderer.getHeight();
    ctx.fillStyle='rgba(7,8,15,0.7)'; ctx.fillRect(0,0,W,H);
    ctx.shadowBlur=20; ctx.shadowColor='#1a8cff';
    ctx.fillStyle='#4db8ff'; ctx.font='48px Orbitron, monospace';
    ctx.textAlign='center'; ctx.fillText('PAUSED',W/2,H/2);
    ctx.shadowBlur=0; ctx.fillStyle='#4a6080';
    ctx.font='12px Share Tech Mono, monospace';
    ctx.fillText('Press P to resume',W/2,H/2+40);
  }

  // ── HOME BASE ─────────────────────────────────────────────

  function _openBase() {
    if (Save.hasActiveRun()) {
      // A contract is already in the air. Going back to the base means
      // writing that ship and crew off — say so plainly.
      UI.notify('A contract is still running — CONTINUE it, or launch a new one and write it off.', 'warn');
    }
    BaseScreen.open();
    STATE = 'base'; _beginFade();
    Audio.playMusic('explore');
  }

  function _updateBase(dt) {
    const action = BaseScreen.update(dt);
    if (action === 'launch') {
      const loadout = BaseScreen.consumeLaunch();
      if (loadout) _startContract(loadout);
    }
    if (action === 'pack') _openPackScreen();
    if (action === 'cpu')  _openCpuBoard(BaseScreen.consumeCpu());
  }

  /**
   * THE CPU BOARD — the same screen as the shelf, with a third grid.
   *
   * Nothing new was built for this. The board is a CargoGrid, the
   * chips are CargoItems, and moving one is the click-pick-up that
   * already moves a He2 drum, which is precisely why a chip cannot
   * end up both mounted and in storage: there is one item and it is
   * in one grid.
   *
   * Mounting is a BASE-ONLY act, by the spec — that is enforced by
   * where this door is, and by nothing else: no other screen ever
   * opens a board.
   */
  function _openCpuBoard(capId) {
    if (typeof LootScreen === 'undefined' || typeof Chips === 'undefined') {
      UI.notify('Cargo system not loaded', 'warn');
      return;
    }
    const cap = Base.captainById?.(capId);
    if (!cap) { UI.notify('No such captain', 'warn'); return; }
    if (cap.away) { UI.notify(`${cap.name} is out on a contract.`, 'warn'); return; }

    const shelf = Base.warehouseGrid?.();
    const board = Chips.board(cap);
    if (!shelf || !board) { UI.notify('Cargo system not loaded', 'warn'); return; }
    board.noRotate = true;          // spec §6.2 — never turn a chip on the board

    const wall = Chips.wallColumn(cap.karma ?? 50);
    _lootReturn = 'base';
    LootScreen.openLoot(shelf, board, {
      title: `PLANSZA CPU — ${cap.name}`,
      subtitle: `karma ${Math.round(cap.karma ?? 50)} · blokada w kolumnie ${wall}`
              + ` · ${wall - 1} kolumn dobra, ${Chips.COLS - wall} zła`
              + ` · ${Chips.rowsFor(cap.level)} z 5 rzędów (poziom ${cap.level})`,
      leftLabel: 'BASE WAREHOUSE',
      holdLabel: 'CPU',
      portType: 'general',
      board: cap,                   // the screen draws the wall and the dead chips
      onSell: (it) => { const paid = it.value('general'); Base.earn(paid); return paid; },
      onClose: ({ hold }) => {
        Chips.commit(cap, hold);
        Base.saveCaptain?.(cap);
        Base.commitWarehouse?.(shelf);
        STATE = 'base'; _beginFade();
      },
    });
    STATE = 'loot'; _beginFade();
  }

  /**
   * The warehouse AND the packing screen — they are the same screen now.
   *
   * There used to be two: PACK HOLD (a throwaway grid built from the
   * fuel/missile counters) and OPEN WAREHOUSE (the salvage shelf). Two
   * views of what the player quite reasonably thought was one shelf, and
   * each needed its own reconciliation with the other. One store, one
   * screen: drag between the shelf and the hold, sell off the shelf, done.
   */
  function _openPackScreen() {
    if (typeof LootScreen === 'undefined' || typeof CargoGrid === 'undefined') {
      UI.notify('Cargo system not loaded', 'warn');
      return;
    }
    const { store, hold } = BaseScreen.packGrids();
    if (!store || !hold) { UI.notify('No hull selected', 'warn'); return; }
    _lootReturn = 'base';
    LootScreen.openLoot(store, hold, {
      title: 'WAREHOUSE',
      subtitle: 'click to pick up, click to put down · R rotates · SPLIT halves a stack · '
              + 'SELL banks CC on the spot',
      leftLabel: 'BASE WAREHOUSE',
      holdLabel: 'SHIP HOLD',
      takeAllLabel: 'LOAD ALL',
      doneLabel: 'DONE',
      portType: 'general',
      onSell: (it) => { const paid = it.value('general'); Base.earn(paid); return paid; },
      onUnpack: (it) => (it.def.kind === 'heal'
        ? { ok: false, message: 'No patient to treat here — pack it for the next contract instead.' }
        : null),
      // No clock: packing before a launch is not a raid.
      onClose: () => { BaseScreen.commitPack?.(); STATE = 'base'; _beginFade(); },
    });
    STATE = 'loot'; _beginFade();
  }

  /** Launch a contract with the loadout the base handed us. */
  function _startContract(loadout) {
    Save.startRun();
    const mission = loadout.mission || MISSIONS.patrol;
    Save.updateRun({
      mission: mission.id,
      finalSector: mission.sectors,
      fuel: loadout.fuel,
      missiles: loadout.missiles,
      shipKey: loadout.ship.key,
    });
    const run = Save.getRun();
    _savedStations = null;
    BossManager.reset(mission.boss);

    /* THE CAPTAIN TAKES THE CHAIR (update43). He is optional — a
       contract flies perfectly well without one. The record that goes
       into the run IS the record in the mess: one object, so his XP
       cannot end up half-written in two places. */
    _captain = null;
    if (typeof Captain !== 'undefined' && loadout.captainId) {
      _captain = Base.captainById?.(loadout.captainId) ?? null;
      if (_captain) {
        _captain.away = true;
        Base.saveCaptain?.(_captain);
        Save.updateRun({ captainId: _captain.id });
      }
    }
    Captain?.setActive?.(_captain);

    // Veteran hull keeps its upgrades; a fresh one is built from the layout
    _playerShip = loadout.ship.data
      ? Ship.deserialise(loadout.ship.data, true, 180, 180)
      : new Ship(loadout.ship.key, true, 180, 180);

    // The hold the player packed in the base travels with the ship.
    if (loadout.hold && _playerShip.cargo && typeof CargoGrid !== 'undefined') {
      _playerShip.cargo = CargoGrid.deserialise(loadout.hold);
      // The racks in the hold ARE the ammo, and the cells ARE the He2 —
      // the HUD figures just mirror them, so nothing needs unpacking.
      _syncAmmo();
      _syncFuel();
    }

    // Spare guns from the armoury: fit what the mounts allow, stow the rest
    (loadout.spareGuns ?? []).forEach(key => {
      let slot = -1;
      for (let i = 0; i < _playerShip.weaponSlots; i++) {
        if (!_playerShip.weapons[i]) { slot = i; break; }
      }
      if (slot === -1 || !_playerShip.installWeapon(key, slot)) {
        _playerShip.weaponCargo.push(key);
      }
    });

    if (loadout.crew && loadout.crew.length) {
      loadout.crew.forEach(cd => _playerShip.addCrew(CrewMember.deserialise(cd)));
    } else {
      // Nobody in the barracks — the guild sends green hands instead
      makeStartingCrew().forEach(c => _playerShip.addCrew(c));
      UI.notify('No veterans available — a fresh crew signed on.', 'info');
    }
    _playerShip.assignStations();

    /* THE SHIP'S CAT COMES ABOARD (update45). After assignStations, so
       nothing tries to give it a post — it is a beast and beasts do not
       stand watches. */
    if (loadout.pet) {
      const cat = CrewMember.deserialise(loadout.pet);
      _playerShip.addCrew(cat);
      UI.notify(`${cat.name} is aboard.`, 'good');
    }

    // The captain's max-HP bonus is a stored number, so it is seated
    // once here rather than recomputed in every frame that reads hp.
    Captain?.reseatMaxHp?.(_playerShip.crew);

    _sosNode = null;   // node ids repeat per sector — clear the beacon lock
    _sectorMap = new SectorMap(run.sector, run.seed,
      run.sector > 1 ? (run.lane ?? 1) : (run.lane ?? null), mission.sectors,
      !!mission.boss);
    _saveShip();
    STATE = 'map'; _beginFade();
    Audio.playMusic('explore');
    UI.notify(`${mission.label} — ${mission.sectors} sectors. Good hunting.`, 'good');
  }

  /** Contract complete and docked: bank the ship, the survivors and
   *  whatever is left in the hold. This is the ONLY way anything gets
   *  back into the base. */
  function _dockAtBase(ccEarned, andThen = null) {
    // ONE SHELF. Everything in the hold — canisters, racks, gun crates,
    // medkits, relics — goes back onto the same warehouse grid it was
    // packed out of, exactly as it is. Nothing is unpacked into a counter.
    let stashedCount = 0;
    const hold = _playerShip?.cargo;
    const shelf = Base.warehouseGrid?.();
    if (hold?.items?.length && shelf) {
      for (const it of [...hold.items]) {
        if (!shelf.autoPlace(it)) continue;
        hold.remove(it);
        stashedCount++;
      }
    }
    if (shelf) Base.commitWarehouse(shelf);

    /* ── WHAT WOULD NOT FIT IS THE PLAYER'S DECISION (update48) ──
     *
     * This used to read:
     *     else { cargoCC += it.value('general'); spilled++; }
     *     hold.clear();
     * — the base bought the overflow at scrap value whether you liked
     * it or not, and the crate you had crossed two sectors for was
     * gone before the outcome screen came up. The player's report is
     * exactly that: "items must not just disappear; the player always
     * gets to choose what to keep and what to throw out."
     *
     * So the shelf and the hold go up side by side and the run does
     * not close until he has said what happens to the rest. He can
     * still sell it — the DONE button says so in CC, out loud — but
     * nothing is sold behind his back.
     */
    if (hold?.items?.length && typeof LootScreen !== 'undefined' && shelf) {
      _lootReturn = 'outcome';
      LootScreen.openLoot(shelf, hold, {
        title: 'DOCKED — WHAT COMES OFF THE SHIP?',
        subtitle: 'the shelf is full · move what you want to keep, sell or dump the rest',
        leftLabel: 'BASE WAREHOUSE',
        holdLabel: 'STILL IN THE HOLD',
        takeAllLabel: 'UNLOAD ALL',
        portType: 'general',
        sellRestOnDone: true,
        onSell: (it) => { const paid = it.value('general'); Base.earn(paid); return paid; },
        onClose: () => {
          Base.commitWarehouse?.(Base.warehouseGrid ? shelf : null);
          _finishDocking(ccEarned, stashedCount, andThen);
        },
      });
      STATE = 'loot'; _beginFade();
      return null;
    }

    return _finishDocking(ccEarned, stashedCount, andThen);
  }

  /** The rest of docking, once the hold is empty one way or another. */
  function _finishDocking(ccEarned, stashedCount, andThen) {
    const run = Save.getRun();
    const shipKey = run?.shipKey || _playerShip?.layoutKey || 'scout';

    // THE CAPTAIN IS HOME. Whatever he learned out there is banked
    // before anything else touches the base.
    if (_captain) {
      _captain.away = false;
      Base.saveCaptain?.(_captain);
    }
    Captain?.setActive?.(null);

    /* THE ANIMAL GOES BACK IN ITS PEN, hungry or not. It is NOT part of
       the crew roster below — `c.isPlayer && !c.dead` would put a cat in
       the barracks as a hireable hand. */
    (_playerShip?.crew ?? [])
      .filter(c => c.isPet && !c.dead)
      .forEach(cat => Base.savePet?.(cat.serialise()));

    /* THE HOLD IS EMPTY BY NOW — either it fitted on the shelf or the
       player said, on the sorting screen above, what happened to the
       rest. Anything still in it would ride home inside the hull's own
       save data, where the base cannot see it and the next launch
       would overwrite it: that is a slower way of losing a crate, not
       a safer one. */
    const rep = Base.returnFromRun({
      shipEntry: _playerShip ? { key: shipKey, data: _playerShip.serialise() } : null,
      // `c.isPlayer` (update42): a surviving enemy boarder, spider or
      // moon rat aboard at docking was BANKED INTO THE BARRACKS and
      // showed up as hireable crew on the next run.
      crew: (_playerShip?.crew ?? [])
        .filter(c => c.isPlayer && !c.dead && !c.isBeast).map(c => c.serialise()),
      // NOTHING loose comes back as units any more (update39). He2
       // rides home in its cells and warheads in their racks, exactly
       // like every other container — passing the mirror numbers here
       // would bank a second copy of both.
      fuel: 0,
      missiles: 0,
      cc: ccEarned,
    });
    const bits = [];
    if (rep.shipStored)   bits.push('hull docked');
    if (rep.crewStored)   bits.push(`${rep.crewStored} crew home`);
    if (rep.fuelStored)   bits.push(`${rep.fuelStored} He2 stored`);
    if (rep.mslStored)    bits.push(`${rep.mslStored} missiles stored`);
    if (rep.cc)           bits.push(`${rep.cc} CC banked`);
    if (stashedCount)     bits.push(`${stashedCount} crate${stashedCount > 1 ? 's' : ''} back on the shelf`);
    UI.notify(bits.length ? bits.join(' · ') : 'Docked.', 'good');

    const lost = [];
    if (rep.fuelLost)       lost.push(`${rep.fuelLost} He2`);
    if (rep.mslLost)        lost.push(`${rep.mslLost} missiles`);
    if (rep.crewTurnedAway) lost.push(`${rep.crewTurnedAway} crew turned away`);
    if (!rep.shipStored && _playerShip) lost.push('no berth for the hull!');
    if (lost.length) UI.notify(`No room for: ${lost.join(', ')} — upgrade the base.`, 'warn');
    andThen?.(rep);
    return rep;
  }

  // ── Helpers ───────────────────────────────────────────────
  function _startNewRun() {
    // Legacy entry point — send the player through the base instead so
    // the hangar, barracks and warehouse actually mean something.
    _openBase();
  }

  function _continueRun() {
    if (!Save.hasActiveRun()) { UI.notify('No saved run.','warn'); return; }
    const run = Save.getRun();
    if (!run?.ship) { _openBase(); return; }
    _savedStations = null;
    /* THE CONTRACT'S OWN BOSS, INCLUDING "NONE" (update38).
     *
     * `MISSIONS[run.mission]?.boss ?? 'station'` reads as a sensible
     * default and is a bug: Courier Run declares `boss: null` on
     * purpose, and `null ?? 'station'` is 'station'. So reloading a
     * boss-less contract armed Apophis and rebuilt the last column as
     * a BOSS node where launching had built an exit — the player saw
     * the main boss on the map of a one-sector courier job. Only a
     * genuinely UNKNOWN mission falls back now. */
    const mission = MISSIONS[run.mission] ?? null;
    const boss    = mission ? mission.boss : 'station';
    BossManager.reset(boss);
    _playerShip = Ship.deserialise(run.ship, true, 180, 180);
    (run.crew||[]).forEach(cd => _playerShip.addCrew(CrewMember.deserialise(cd)));

    /* THE CAPTAIN COMES BACK WITH THE RUN (update43). The mess holds
       the authoritative record; the run only remembers WHICH captain
       is out. An id that no longer matches anybody (an old save, a
       deleted mess) simply means this contract flies without one. */
    _captain = (typeof Captain !== 'undefined' && run.captainId)
      ? (Base.captainById?.(run.captainId) ?? null) : null;
    Captain?.setActive?.(_captain);
    // Crew HP came out of the save with the bonus already in it, so
    // this only re-seats the baseline; it never heals.
    Captain?.reseatMaxHp?.(_playerShip.crew);

    _sosNode = null;   // node ids repeat per sector — clear the beacon lock
    _sectorMap = new SectorMap(run.sector, run.seed,
      run.sector > 1 ? (run.lane ?? 1) : (run.lane ?? null),
      run.finalSector ?? mission?.sectors ?? 3,
      !!boss);
    // …and put him back on the node he was standing on, with the rest
    // of the sector still behind him.
    _sectorMap.restoreProgress(run.mapProgress);
    STATE = 'map';
    Audio.playMusic('explore');
  }

  function _spawnEnemy(difficulty='normal') {
    // Random hull layout — different module arrangements per encounter.
    // Elites favour the Gunship (it has TWO weapon module rooms).
    const layoutKey = (difficulty === 'hard')
      ? Utils.pick(['enemy_gunship', 'enemy_gunship', 'enemy_raider'])
      : Utils.pick(['enemy_frigate', 'enemy_gunship', 'enemy_raider']);
    _enemyShip = new Ship(layoutKey, false, 850, 200);
    const sector = Save.getRun()?.sector ?? 1;
    const elite  = difficulty === 'hard';

    // ── Hull scaling ──
    if (sector === 1) {
      _enemyShip.hull    = elite ? 16 : 12;
    } else {
      _enemyShip.hull    = (elite ? 24 : 18) + (sector - 2) * 5;
    }
    _enemyShip.hullMax = _enemyShip.hull;

    // ── What the raider fitted in her spare bay ──
    //  A raider hull has exactly ONE bay going spare, so shields and a
    //  cloak COMPETE for it — this is a single roll, not two, otherwise
    //  whichever was rolled first would always win and the other would
    //  effectively never appear.
    //    shields → you have to shoot through something
    //    cloak   → the AI blinks out when hurt and your volley whiffs
    //  (The player's own starter hull has no shields either, so an
    //   unshielded raider is a fair fight, not a free win.)
    const loadout = (() => {
      const roll = Math.random();
      if (elite) return roll < 0.60 ? 'shields' : 'cloak';
      // SECTOR 1 HAS NO SHIELDS AT ALL. One layer takes a starting laser
    // six seconds a bolt to chip through, which is most of the opening
    // sector spent watching a bubble absorb everything you have. The
    // first sector is where the player learns the controls; it should
    // not also be the hardest wall they meet.
    if (sector === 1) return roll < 0.45 ? 'cloak' : 'empty';
      if (sector === 2) return roll < 0.50 ? 'shields' : roll < 0.75 ? 'cloak' : 'empty';
      return roll < 0.60 ? 'shields' : roll < 0.90 ? 'cloak' : 'empty';
    })();

    const sh = _enemyShip.getSystem('shields');
    if (sh) {
      if (loadout === 'shields') {
        sh.level = elite ? (sector >= 2 ? 4 : 2) : 2;   // 2 pips = 1 layer
        sh.desiredPower = sh.level;
      } else {
        // Bay stripped back to bare frame — free for something else
        const room = _enemyShip.getRoomById(sh.roomId);
        if (room) { room.system = null; room.type = 'empty'; }
        _enemyShip.systems = _enemyShip.systems.filter(s => s !== sh);
      }
    }

    if (loadout === 'cloak' && _enemyShip.addModule('cloaking')) {
      const cl = _enemyShip.getSystem('cloaking');
      if (cl) { cl.level = 1; cl.desiredPower = cl.level; }
    }

    /* ── EVERY WEAPON BAY GETS A GUN (update42) ──────────────
       The second gun used to be gated on `elite || sector >= 2`, so a
       sector-1 Gunship flew with two weapon modules, four crew and ONE
       laser — and `assignStations` posted a gunner to the empty bay,
       where he sat at a dead console for the whole fight. If the hull
       has the bay, the bay is armed; sector and elite decide how GOOD
       the gun is, not whether it exists. */
    for (let slot = 1; slot < _enemyShip.weaponRooms.length; slot++) {
      if (_enemyShip.weapons[slot]) continue;
      const heavy = elite && sector >= 2;
      _enemyShip.installWeapon(heavy ? 'laser_heavy' : 'laser_basic', slot);
    }
    // ── Balance rule: weapon module level EQUALS its gun's power
    //    cost (1-power gun → lvl-1 module, 2-power → lvl-2). ──
    _enemyShip.weapons.forEach((w, i) => {
      if (!w) return;
      const sys = _enemyShip.weaponSystemFor(i);
      if (!sys) return;
      sys.level        = w.powerCost;
      sys.desiredPower = sys.level;
    });
    // Gunless weapon modules idle at level 1
    _enemyShip.weaponRooms.forEach((r, i) => {
      if (!_enemyShip.weapons[i] && r.system) {
        r.system.level = 1; r.system.desiredPower = 0;
      }
    });

    // ── Balance rule: reactor level EQUALS the total power the ship
    //    needs to run every module at full (capped by the hull). ──
    const need = _enemyShip.systems
      .filter(s => s.type !== 'reactor')
      .reduce((a, s) => a + s.maxPower, 0);
    _enemyShip.reactor.level = Math.min(need, _enemyShip.reactor.maxLevel);
    _enemyShip._allocateDefaultPower();

    // Crew sized so every GUN has an operator (operator rule):
    // pilot + one gunner per installed weapon + 1 spare repairer.
    //
    // FLOORS (update38). A two-man crew meant a boarding party of three
    // walked onto an empty ship and the fight was over before it started.
    // Every hull now carries at least THREE, and a hull with two weapon
    // BAYS carries at least FOUR — the bays are what the ship has room
    // for, so the floor holds even when only one gun is fitted.
    const guns     = _enemyShip.weapons.filter(w => w).length;
    const gunRooms = _enemyShip.weaponRooms.length;
    const floor    = gunRooms >= 2 ? 4 : 3;
    const crewN    = Math.max(floor, 1 + guns + (elite ? 1 : 0));
    makeEnemyCrew(crewN, _enemyShip.layoutKey).forEach(c=>_enemyShip.addCrew(c));
    _enemyShip.assignStations();
  }

  /** Start combat vs a fresh enemy. In a nebula BOTH ships run at −2 power. */
  function _startCombat(difficulty, nebula = false) {
    _spawnEnemy(difficulty);
    _nebulaCombat   = nebula;
    _surrenderAsked = false;
    _derelictOffered = false;
    _boardingParty = null; _enemyParty = null; _counterBoarded = false;
    _playerShip.reactor.penalty = nebula ? 2 : 0;
    _enemyShip.reactor.penalty  = nebula ? 2 : 0;
    // The player's power layout CARRIES OVER between fights — it used
    // to be wiped back to defaults every battle, undoing whatever they
    // had set up. Only a ship that has never been configured (fresh
    // run) gets the automatic spread. The enemy always re-rolls.
    if (!_playerShip.hasPowerPreference()) _playerShip._allocateDefaultPower();
    _enemyShip._allocateDefaultPower();
    // Shields are ACTIVE from the first second on BOTH sides
    _playerShip.prechargeShields();
    _enemyShip.prechargeShields();
    // …but GUNS are NOT: charging starts when the battle does
    [_playerShip, _enemyShip].forEach(sh => sh.weapons.forEach(w => {
      if (w) { w.charge = 0; w.armed = false; }
    }));
    // Unburied corpses begin to rot once a new fight starts
    _playerShip.markCombatStart();
    _playerShip.weapons.forEach(w => { if (w) w.targetRoom = null; });

    /* ── THE OTHER SIDE HAS A CAPTAIN TOO (update50) ────────
       Not every ship: a lone scout in sector 1 is a lone scout. The
       further in, the likelier — and the boss always has one. He is
       seated here and cleared the moment the fight ends, so he can
       never pay bonuses to the next enemy. */
    if (typeof Captain !== 'undefined' && Captain.rollEnemy) {
      const sec = Save.getRun()?.sector ?? 1;
      const chance = BossManager.isActive ? 1 : Math.min(0.55, 0.12 + sec * 0.12);
      const boss = Math.random() < chance
        ? Captain.rollEnemy(sec, BossManager.isActive ? { level: 6 + sec, chips: 2 } : {})
        : null;
      Captain.setEnemy(boss);
      if (boss && _enemyShip) {
        _enemyShip.captain = boss;
        Captain.reseatMaxHp?.(_enemyShip.crew);
      }
    }

    STATE = 'combat'; _beginFade(); _combatTimer = 0; _combatFired = false;
    CombatManager.begin(_playerShip, _enemyShip, difficulty === 'hard' ? 'hard' : _difficulty());
    Audio.resume(); Audio.playMusic('combat');
    if (nebula) UI.notify('NEBULA — both ships at −2 power', 'warn');
  }

  /** 35%: hostiles hail you and demand tribute instead of fighting */
  function _maybeNegotiate(difficulty, nebula) {
    const run = Save.getRun();
    const toll = 15 + (run?.sector ?? 1) * 10;
    const choices = [
      { label: `Pay ${toll} CC tribute`, result: { scrap: -toll } },
    ];
    if (_playerShip.crew.length > 1) {
      /* Handing one of your own to a raider to save the rest is the
         worst thing on the karma table that is not an evacuation. */
      choices.push({ label: 'Hand over a crew member',
                     result: { loseCrew: true,
                               karma: Captain?.KARMA?.KILL_HELPLESS ?? -10 } });
    }
    choices.push({ label: 'Refuse — battle stations!', result: { startPending: true } });
    _pendingCombat = { difficulty, nebula };
    _event = {
      title: 'Hailing Frequencies',
      text: nebula
        ? 'A ship emerges from the nebula. "Tribute, or we take it from your wreck." Sensors show the nebula drains −2 power from BOTH ships.'
        : '"This is our territory. Pay the toll — minerals or a pair of hands — or we open fire."',
      choices,
    };
    STATE = 'event';
  }

  /** DISTRESS BEACON — the tank is dry and the drive can't spin up.
   *  Somebody always answers; the question is what they want for the
   *  He2. This is the anti-softlock: the 'beg' branch always yields
   *  fuel, so a run can never dead-end on an empty tank. */
  /* THE BEACON IS A RESCUE, NOT A FUEL TAP (update42).
     `_travelTo` refused a dry jump and then opened this event EVERY
     time, with no limit — so an empty hold cost nothing: click a node,
     beg, take 1-2 He2, click again. He2 was the one resource in the
     game with no teeth. The beacon now answers ONCE per node; stay put
     with a dry hold and the channel goes quiet. */
  let _sosNode = null;

  function _maybeSOS(force = false) {
    const run = Save.getRun();
    if (!run) return;
    const here = _sectorMap?.currentId ?? null;
    // `force` is the re-offer after an unaffordable trade: that is the
    // SAME broadcast still on the air, not a second one.
    if (!force && _sosNode !== null && _sosNode === here) {
      UI.notify('The channel is dead — nobody else is out here.', 'alert');
      return;
    }
    _sosNode = here;
    const sector  = run.sector ?? 1;
    const price   = 25 + sector * 15;          // trader's asking price
    const canPay  = run.scrap >= price;
    const cargo   = _playerShip?.weaponCargo?.length > 0;

    const choices = [];
    choices.push({
      label: canPay ? `Buy 4 He2 from the trader (${price} CC)`
                    : `Buy 4 He2 — need ${price} CC (you have ${run.scrap})`,
      result: canPay ? { scrap: -price, fuel: 4 } : { sosRetry: true },
    });
    if (cargo) {
      choices.push({
        label: 'Trade a spare weapon from cargo for 5 He2',
        result: { sosTradeWeapon: true },
      });
    }
    choices.push({
      // Robbing people who came to sell to you: "ograbienie kosztem innych".
      label: 'Answer the scavengers — take their He2 by force',
      result: { sosFight: true, karma: Captain?.KARMA?.ROBBERY ?? -5 },
    });
    choices.push({
      label: 'Beg for a fuel donation (they will not be generous)',
      result: { sosBeg: true },
    });

    _event = {
      title: 'Distress Beacon',
      text: `The He2 tanks are dry and the drive will not spin up. You broadcast on the open channel. ` +
            `A scavenger crew answers — they have fuel, and they are curious about what you will pay for it.`,
      choices,
    };
    STATE = 'event';
  }

  function _difficulty() {
    const s = Save.getRun()?.sector ?? 1;
    return s>=6?'hard':s>=3?'normal':'easy';
  }

  function _nextSector() {
    const run = Save.getRun(); if (!run) return;
    const final = run.finalSector ?? MISSIONS[run.mission]?.sectors ?? 3;
    const next = run.sector + 1;
    // Past the last sector with no boss left to fight = contract done
    if (next > final) { _finishContract(); return; }
    // A fresh sector starts at its entry lane: clear last sector's
    // node progress, or CONTINUE would try to restore a node id that
    // belongs to a map that no longer exists.
    Save.updateRun({ sector:next, nodeIndex:0, seed:Math.floor(Math.random()*1e9),
                     mapProgress: null });
    // Same `?? 'station'` trap as _continueRun — a contract with
    // boss: null must NOT grow a boss column on the way through.
    const mission = MISSIONS[run.mission] ?? null;
    _sosNode = null;   // node ids repeat per sector — clear the beacon lock
    _sectorMap = new SectorMap(next, Save.getRun().seed, Save.getRun().lane ?? 1, final,
      !!(mission ? mission.boss : 'station'));
    UI.notify(`Entering Sector ${next}`,'good');
    STATE='map'; _beginFade();
  }

  /** Contract complete: pay the bonus, dock everything at the base and
   *  show the outcome screen. */
  function _finishContract() {
    const run     = Save.getRun();
    const mission = MISSIONS[run?.mission] || MISSIONS.mothership;
    const bossCC  = BossManager.isActive || BossManager.ship ? BossManager.scrapReward : 0;
    const held    = (run?.scrap ?? 0) + bossCC;
    if (run) Save.updateRun({ scrap: held });

    // Banked CC: half of what you finish holding, plus the contract bonus
    const banked = Math.floor(held * 0.5) + mission.ccBonus;

    /* DOCKING CAN NOW STOP AND ASK (update48). If the shelf could not
       take everything, _dockAtBase puts the sorting screen up and calls
       this back when the player is done — so the outcome screen must
       wait for it rather than being set two lines below. */
    _dockAtBase(banked, () => {
      _outcomeType  = 'victory';
      _outcomeScrap = held;
      Save.endRun(true);
      STATE = 'outcome'; _beginFade(); _outcomeTimer = 0;
      Audio.stopMusic(1.0);
    });
  }

  /** Put one on everybody's record — the memorial reads these off the
   *  headstone, so they have to be counted while people are still alive
   *  to earn them. Boarders on the enemy hull count too: they were very
   *  much present. */
  function _creditCrew(field) {
    const all = [
      ...(_playerShip?.crew ?? []),
      ...((_enemyShip?.crew ?? []).filter(c => c.isPlayer)),
    ];
    all.forEach(c => { if (c.alive) c[field] = (c[field] ?? 0) + 1; });
  }

  /** Was the thing we just killed the contract's boss? */
  function _bossJustBeaten() {
    if (typeof BossManager === 'undefined') return false;
    // The manager clears `isActive` as the last phase dies, so the
    // flag to read is that it WAS running and has no phases left.
    return !!BossManager.ship && !BossManager.isActive;
  }

  /**
   * Hand the player a chip. Never silently: it lands in the hold, and
   * if there is no room the hold screen opens so he chooses what to
   * drop for it — the same rule update48 gave the docking bay.
   */
  function _awardChip(opts, from) {
    if (typeof Chips === 'undefined' || !_playerShip?.cargo) return null;
    const sector = Save.getRun()?.sector ?? 1;
    const key = Chips.rollDrop(sector, { ...opts, maxLevel: opts.maxLevel ?? 4 });
    const it = _playerShip.cargo.add(key);
    const def = CARGO_ITEMS[key];
    if (it) {
      UI.notify(`${def.label} recovered from ${from}.`, 'good');
      return it;
    }
    UI.notify(`${def.label} from ${from} — no room in the hold, make some.`, 'warn');
    _queuedChip = key;
    return null;
  }

  function _onWin() {
    // The enemy captain leaves with his ship (update50).
    Captain?.setEnemy?.(null);
    const reward = CombatManager.scrapReward;
    const run = Save.getRun();
    if (run) Save.updateRun({ scrap: run.scrap+reward });
    UI.notify(`+${reward} CC`,'good');
    Audio.sfx.scrapCollect();
    // Jumps burn He2, so wrecks have to give some back — otherwise a
    // long sector between stations can strand the run for good.
    {
      const r2 = Save.getRun();
      // A fight picked BECAUSE we were dry always pays out in fuel —
      // that is the whole reason we took it.
      if (r2 && _sosFightPending) {
        const gain = Utils.randIn(4, 7);
        _sosFightPending = false;
        const r = _addFuel(gain);
        UI.notify(`Their tanks are ours: ${_fuelGainMessage(r)}`, r.spilled ? 'warn' : 'good');
      } else if (r2 && Math.random() < 0.5) {
        const gain = Utils.randIn(1, 2);
        const r = _addFuel(gain);
        UI.notify(`${_fuelGainMessage(r)} siphoned from the wreck`, r.spilled ? 'warn' : 'good');
      }
    }
    /* ── A BOSS ALWAYS PAYS A CHIP (update49, spec §9) ────────
     *
     * Not a roll: exactly one, guaranteed, from the pair of levels
     * that fight is worth. The Border Patrol boss hands out a II or a
     * III; Apophis is the ONLY source of a level IV in the game.
     *
     * It goes through _awardChip, which puts it in the hold or, when
     * the hold is full, opens the hold screen rather than dropping it
     * — a guaranteed reward that silently evaporates is worse than no
     * reward at all, and update48 built that door already. */
    if (_bossJustBeaten()) {
      const run3 = Save.getRun();
      const apophis = (MISSIONS[run3?.mission]?.sectors ?? 2) >= 3;
      _awardChip(apophis ? { minLevel: 3, maxLevel: 4 } : { minLevel: 2, maxLevel: 3 },
                 apophis ? 'Apophis' : 'the patrol boss');
    }

    // Winning a gun duel is not melee practice — no combat XP here.
    _tickInfections();
    if (CombatManager.weaponDrop && _playerShip) {
      // Install into a free weapon MODULE, otherwise stash it in cargo
      let slot = -1;
      for (let i = 0; i < _playerShip.weaponRooms.length; i++) {
        if (!_playerShip.weapons[i]) { slot = i; break; }
      }
      if (slot !== -1 && _playerShip.installWeapon(CombatManager.weaponDrop, slot)) {
        UI.notify('Weapon recovered and installed!', 'good');
      } else {
        // No free mount — the crate has to go in the hold, and that is
        // a decision, so it gets its own screen once the fight settles.
        _queueWeaponLocker(CombatManager.weaponDrop);
      }
    }
  }

  function _onLose() {
    // The enemy captain leaves with his ship (update50).
    Captain?.setEnemy?.(null);
    _sosFightPending = false;
    // The hull and everyone aboard were CHECKED OUT of the base at
    // launch — losing here simply means they never come back. There is
    // nothing to delete; the hangar and barracks have been short all along.
    Base.loseRun();
    /* HE GOES DOWN WITH HER (update43). The base, the other captains
       and everything left on the shelf are untouched — only his levels
       and his karma are gone. No end of game. */
    if (_captain) {
      const lostName = _captain.name;
      Base.loseCaptain?.(_captain.id);
      UI.notify(`Captain ${lostName} was lost with the ship.`, 'alert');
      _captain = null;
    }
    Captain?.setActive?.(null);
    const lostShip = SHIP_CATALOG[Save.getRun()?.shipKey]?.label ?? 'The ship';
    UI.notify(`${lostShip} and her crew are lost — the base keeps only what came home.`, 'alert');
    _outcomeType='defeat'; _outcomeScrap=0;
    Save.endRun(false); Audio.stopMusic(1.0);
    STATE='outcome'; _beginFade(); _outcomeTimer=0;
  }

  function _saveShip() {
    if (!_playerShip) return;
    const patch = {
      ship: _playerShip.serialise(),
      // Intruders are not part of the ship (update42) — but beasts are:
      // a spider or a rat infestation has to survive a save/reload.
      crew: _playerShip.crew.filter(c => c.isPlayer || c.isBeast)
                            .map(c => c.serialise()),
    };
    /* WHERE WE GOT TO (update38).
     * _saveShip runs after every jump, so this is the one place that is
     * guaranteed to see the map right after it moved. Without it,
     * reloading mid-contract flew the whole sector again — the save
     * knew the sector number and the seed but not the node. */
    if (_sectorMap?.serialiseProgress) patch.mapProgress = _sectorMap.serialiseProgress();
    Save.updateRun(patch);
  }

  /* The renderer draws the order buttons grey without a captain, and
     it must be asking the SAME question the click handler answers —
     a button that looks live and then refuses is worse than one that
     is plainly dead. This is that one question, published. */
  return { init, hasCaptain: _hasCaptain };
})();

window.addEventListener('DOMContentLoaded', () => {
  Game.init().catch(err => console.error('[Game] Fatal:', err));
});
window.addEventListener('pointerdown', () => Audio.resume(), { once: true });
