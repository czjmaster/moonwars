/* ============================================================
   MOON WARS — game.js
   Main entry point. Game state machine + main loop.
   States: LOADING → MENU → MAP → COMBAT → EVENT → STATION
           → VICTORY → DEFEAT → GRAVEYARD
   ============================================================ */

'use strict';

const Game = (() => {

  const STATE = {
    LOADING:  'loading',
    MENU:     'menu',
    MAP:      'map',
    COMBAT:   'combat',
    EVENT:    'event',
    STATION:  'station',
    OUTCOME:  'outcome',
  };

  let _state            = STATE.LOADING;
  let _prevTime         = 0;
  let _paused           = false;

  let _playerShip       = null;
  let _enemyShip        = null;
  let _sectorMap        = null;
  let _station          = null;
  let _currentEvent     = null;

  let _menuHover        = null;
  let _mapHoverNode     = null;

  let _outcomeType      = null;
  let _outcomeScrap     = 0;
  let _outcomeTimer     = 0;
  let _combatOutcomeTimer = 0;
  let _combatOutcomeFired = false;

  // ── Init ──────────────────────────────────────────────────

  async function init() {
    const canvas = document.getElementById('game-canvas');
    Renderer.init(canvas);
    Input.init(canvas);
    Audio.init();
    Save.load();

    const settings = Save.getSettings();
    Audio.setMasterVolume(settings.masterVolume ?? 0.8);
    Audio.setSfxVolume(settings.sfxVolume ?? 1.0);
    Audio.setMusicVolume(settings.musicVolume ?? 0.35);

    Utils.setLoadingProgress(5, 'Generating sprites…');
    await Assets.init((pct, msg) => {
      Utils.setLoadingProgress(10 + pct * 70, msg);
    });

    Utils.setLoadingProgress(82, 'Animating crew…');
    Animation.init();

    Utils.setLoadingProgress(95, 'Calibrating systems…');
    await _sleep(200);
    Utils.setLoadingProgress(100, 'Ready.');
    await _sleep(400);
    Utils.hideLoadingScreen();

    _setState(STATE.MENU);
    Audio.resume();
    requestAnimationFrame(_loop);
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── State machine ─────────────────────────────────────────

  function _setState(newState) {
    _state = newState;
    Input.clearCanvasListeners();
    _mapHoverNode = null;
    _currentEvent = null;

    switch (newState) {
      case STATE.MENU:
        Audio.playMusic('explore');
        _playerShip = null;
        _enemyShip  = null;
        _registerMenuButtons();
        break;

      case STATE.MAP:
        Audio.playMusic('explore');
        _rebuildMapHitAreas();
        break;

      case STATE.COMBAT:
        _combatOutcomeTimer = 0;
        _combatOutcomeFired = false;
        CombatManager.begin(_playerShip, _enemyShip, _combatDifficulty());
        break;

      case STATE.EVENT:
        _registerEventChoices();
        break;

      case STATE.STATION:
        UI.openStation(_station, _playerShip);
        break;

      case STATE.OUTCOME:
        _outcomeTimer = 0;
        break;
    }
  }

  // ── Menu ─────────────────────────────────────────────────

  function _registerMenuButtons() {
    const W  = Renderer.getWidth();
    const H  = Renderer.getHeight();
    const cx = W / 2, cy = H / 2;

    const buttons = [
      { id: 'new_game',  label: 'NEW GAME',  cb: startNewRun },
      { id: 'continue',  label: 'CONTINUE',  cb: continueRun },
      { id: 'graveyard', label: 'GRAVEYARD', cb: () => UI.showGraveyard() },
      { id: 'settings',  label: 'SETTINGS',  cb: () => {} },
    ];

    buttons.forEach((b, i) => {
      const bx = cx - 100, by = cy - 40 + i * 50;
      Input.onCanvasClick({ x: bx, y: by, w: 200, h: 36 }, () => {
        Audio.sfx.uiClick();
        b.cb();
      });
    });
  }

  function _updateMenu() {
    const mx = Input.mouse.x, my = Input.mouse.y;
    const cx = Renderer.getWidth() / 2, cy = Renderer.getHeight() / 2;
    _menuHover = null;
    const ids = ['new_game', 'continue', 'graveyard', 'settings'];
    ids.forEach((id, i) => {
      const bx = cx - 100, by = cy - 40 + i * 50;
      if (Utils.pointInRect(mx, my, bx, by, 200, 36)) _menuHover = id;
    });
  }

  // ── New run / continue ────────────────────────────────────

  function startNewRun() {
    Save.startRun();
    const run = Save.getRun();
    _playerShip = new Ship('frigate', true, 60, 160);
    makeStartingCrew().forEach(c => _playerShip.addCrew(c));
    _sectorMap = new SectorMap(run.sector, run.seed);
    _setState(STATE.MAP);
  }

  function continueRun() {
    if (!Save.hasActiveRun()) {
      UI.notify('No saved run found.', 'warn');
      return;
    }
    const run = Save.getRun();
    if (!run.ship) { startNewRun(); return; }
    _playerShip = Ship.deserialise(run.ship, true, 60, 160);
    (run.crew || []).forEach(cd => _playerShip.addCrew(CrewMember.deserialise(cd)));
    _sectorMap = new SectorMap(run.sector, run.seed);
    _setState(STATE.MAP);
  }

  // ── Map ──────────────────────────────────────────────────

  function _rebuildMapHitAreas() {
    if (!_sectorMap) return;
    Input.clearCanvasListeners();
    const ox = (Renderer.getWidth()  - 700) / 2;
    const oy = (Renderer.getHeight() - 400) / 2;
    const R  = 20;
    _sectorMap.nodes.forEach(node => {
      if (node.locked) return;
      const nx = node.x + ox, ny = node.y + oy;
      Input.onCanvasClick({ x: nx - R, y: ny - R, w: R * 2, h: R * 2 }, () => {
        _travelToNode(node.id);
      });
    });
  }

  function _updateMapHover() {
    if (!_sectorMap) return;
    const mx = Input.mouse.x, my = Input.mouse.y;
    const ox = (Renderer.getWidth()  - 700) / 2;
    const oy = (Renderer.getHeight() - 400) / 2;
    _mapHoverNode = null;
    _sectorMap.nodes.forEach(node => {
      if (node.locked) return;
      const nx = node.x + ox, ny = node.y + oy;
      if (Utils.dist(mx, my, nx, ny) < 22) _mapHoverNode = node.id;
    });
  }

  function _travelToNode(nodeId) {
    if (!_sectorMap.travelTo(nodeId)) return;
    Audio.sfx.uiClick();
    const node = _sectorMap.getNode(nodeId);
    _sectorMap.unlockNext();
    _saveShipToRun();

    switch (node.type) {
      case 'combat':
      case 'elite':
        _spawnEnemy(node.type === 'elite' ? 'hard' : 'normal');
        _setState(STATE.COMBAT);
        break;
      case 'store':
        _station = new Station(Save.getRun()?.sector ?? 1, Date.now());
        _setState(STATE.STATION);
        break;
      case 'event':
        if (node.event) {
          _currentEvent = node.event;
          _setState(STATE.EVENT);
        } else {
          _rebuildMapHitAreas();
        }
        break;
      case 'exit':
        _advanceSector();
        break;
      case 'boss':
        _startBoss();
        break;
      default:
        UI.notify('Path clear.', 'info');
        _rebuildMapHitAreas();
        break;
    }
  }

  function _advanceSector() {
    const run = Save.getRun();
    if (!run) return;
    const next = run.sector + 1;
    if (next > 8) {
      _outcomeType  = 'victory';
      _outcomeScrap = run.scrap;
      Save.endRun(true);
      Save.addScrapBank(Math.floor(run.scrap * 0.5));
      _setState(STATE.OUTCOME);
      return;
    }
    Save.updateRun({ sector: next, nodeIndex: 0, seed: Math.floor(Math.random() * 1e9) });
    _sectorMap = new SectorMap(next, Save.getRun().seed);
    UI.notify(`Entering Sector ${next}`, 'good');
    _setState(STATE.MAP);
  }

  // ── Enemy ────────────────────────────────────────────────

  function _spawnEnemy(difficulty = 'normal') {
    _enemyShip = new Ship('enemy_frigate', false, 820, 160);
    const sector = Save.getRun()?.sector ?? 1;
    _enemyShip.hull    += (sector - 1) * 3;
    _enemyShip.hullMax += (sector - 1) * 3;
    makeEnemyCrew(2 + Math.floor(sector / 2)).forEach(c => _enemyShip.addCrew(c));
    if (difficulty === 'hard' && sector >= 3) {
      try { _enemyShip.installWeapon('laser_burst', 1); } catch(e) {}
    }
  }

  function _combatDifficulty() {
    const sector = Save.getRun()?.sector ?? 1;
    if (sector >= 6) return 'hard';
    if (sector >= 3) return 'normal';
    return 'easy';
  }

  // ── Boss ─────────────────────────────────────────────────

  function _startBoss() {
    const ship = BossManager.start(0, 820, 80);
    _enemyShip = ship;
    _setState(STATE.COMBAT);
    Audio.sfx.bossWarning();
    UI.notify('WARNING: MOTHERSHIP DETECTED', 'alert');
  }

  function _checkBossPhase() {
    const result = BossManager.update(0);
    if (result === 'next_phase') {
      CombatManager.end();
      UI.notify(`MOTHERSHIP — PHASE ${BossManager.phase + 2}`, 'alert');
      _enemyShip = BossManager.nextPhase(820, 80);
      _combatOutcomeTimer = 0;
      _combatOutcomeFired = false;
      CombatManager.begin(_playerShip, _enemyShip, 'boss');
    } else if (result === 'defeated') {
      _onCombatVictory();
    }
  }

  // ── Event ────────────────────────────────────────────────

  function _registerEventChoices() {
    if (!_currentEvent) return;
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    const EW = 480, EH = 240;
    const ex = W/2 - EW/2, ey = H/2 - EH/2;
    _currentEvent.choices.forEach((c, i) => {
      const bx = ex + 20, by = ey + 150 + i * 36, bw = EW - 40, bh = 28;
      Input.onCanvasClick({ x: bx, y: by, w: bw, h: bh }, () => {
        Audio.sfx.uiClick();
        _resolveEventChoice(i);
      });
    });
  }

  function _resolveEventChoice(idx) {
    if (!_currentEvent) return;
    const result = _currentEvent.choices[idx]?.result ?? {};
    const run    = Save.getRun();
    if (!run) return;

    if (result.scrap) {
      const amt = Array.isArray(result.scrap)
        ? Utils.randInt(result.scrap[0], result.scrap[1])
        : result.scrap;
      Save.updateRun({ scrap: Math.max(0, run.scrap + amt) });
      UI.notify(amt >= 0 ? `+⬡${amt} scrap` : `-⬡${Math.abs(amt)} scrap`,
                amt >= 0 ? 'good' : 'warn');
    }
    if (result.fuel) {
      const amt = Array.isArray(result.fuel) ? Utils.randInt(result.fuel[0], result.fuel[1]) : result.fuel;
      Save.updateRun({ fuel: run.fuel + amt });
      UI.notify(`+${amt} fuel`, 'good');
    }
    if (result.missiles) {
      const amt = Array.isArray(result.missiles) ? Utils.randInt(result.missiles[0], result.missiles[1]) : result.missiles;
      Save.updateRun({ missiles: run.missiles + amt });
      UI.notify(`+${amt} missiles`, 'good');
    }
    if (result.crew && _playerShip && _playerShip.crew.length < 8) {
      const c = new CrewMember({});
      _playerShip.addCrew(c);
      UI.notify(`${c.name} joined the crew!`, 'good');
    }
    if (result.risk === 'crew_damage' && _playerShip && _playerShip.crew.length > 0) {
      const target = Utils.pick(_playerShip.crew.filter(c => !c.dead));
      if (target) {
        const dmg = Utils.randInt(10, 40);
        target.takeDamage(dmg, 'boarding');
        UI.notify(`${target.name} took ${dmg} damage!`, 'alert');
      }
    }
    if (result.combat) {
      _currentEvent = null;
      _spawnEnemy(result.combat);
      _setState(STATE.COMBAT);
      return;
    }

    _currentEvent = null;
    _setState(STATE.MAP);
  }

  // ── Combat resolution ─────────────────────────────────────

  function _onCombatVictory() {
    if (_combatOutcomeFired) return;
    _combatOutcomeFired = true;
    const reward = CombatManager.scrapReward;
    const run    = Save.getRun();
    if (run) Save.updateRun({ scrap: run.scrap + reward });
    UI.notify(`+⬡${reward} scrap`, 'good');
    Audio.sfx.scrapCollect();
    if (_playerShip) _playerShip.crew.forEach(c => c.addXP('combat', 15));
    if (CombatManager.weaponDrop) {
      const wd  = CombatManager.weaponDrop;
      const def = getWeaponDef(wd);
      const slot = _playerShip?.weapons.findIndex(w => !w) ?? -1;
      if (slot !== -1 && _playerShip) {
        _playerShip.installWeapon(wd, slot);
        UI.notify(`Recovered: ${def?.label ?? wd}`, 'good');
      }
    }
  }

  function _onCombatDefeat() {
    _outcomeType  = 'defeat';
    _outcomeScrap = 0;
    Save.endRun(false);
    Audio.stopMusic(1.0);
    _setState(STATE.OUTCOME);
  }

  // ── Save ─────────────────────────────────────────────────

  function _saveShipToRun() {
    if (!_playerShip) return;
    Save.updateRun({
      ship: _playerShip.serialise(),
      crew: _playerShip.crew.map(c => c.serialise()),
    });
  }

  // ── Main loop ─────────────────────────────────────────────

  function _loop(timestamp) {
    requestAnimationFrame(_loop);
    const dt = Math.min((timestamp - _prevTime) / 1000, 0.05);
    _prevTime = timestamp;

    Input.beginFrame();

    if (Input.isPressed('Escape') || Input.isPressed('KeyP')) {
      if (_state === STATE.COMBAT || _state === STATE.MAP) _paused = !_paused;
    }

    if (!_paused) _update(dt);
    _draw();
  }

  // ── Update ───────────────────────────────────────────────

  function _update(dt) {
    UI.update(dt);
    Camera.update(dt);
    Particles.update(dt);

    switch (_state) {
      case STATE.MENU:
        _updateMenu();
        break;

      case STATE.MAP:
        if (_playerShip) _playerShip.update(dt);
        _updateMapHover();
        break;

      case STATE.COMBAT:
        _updateCombat(dt);
        break;

      case STATE.STATION:
        if (_playerShip) _playerShip.update(dt);
        break;

      case STATE.OUTCOME:
        _outcomeTimer += dt;
        if (_outcomeTimer > 1.0 &&
            (Input.isPressed('Space') || Input.isPressed('Enter') || Input.mouse.leftPressed)) {
          _setState(STATE.MENU);
        }
        break;
    }
  }

  function _updateCombat(dt) {
    if (!_playerShip || !_enemyShip) return;

    _playerShip.update(dt);
    _enemyShip.update(dt);
    CombatManager.update(dt);

    // Crew click-to-move
    const sel = UI.getSelectedCrew();
    if (sel && Input.mouse.leftPressed) {
      const wx = Input.mouse.x, wy = Input.mouse.y;
      if (_playerShip.rooms.some(r => r.contains(wx, wy))) sel.moveTo(wx, wy);
    }

    // Weapon hotkeys 1-4
    ['Digit1','Digit2','Digit3','Digit4'].forEach((code, i) => {
      if (Input.isPressed(code)) {
        const w = _playerShip.weapons[i];
        if (w && w.armed) CombatManager.playerFire(w);
      }
    });

    // Retreat key
    if (Input.isPressed('KeyR') && CombatManager.isActive()) {
      CombatManager.initiateRetreat(1);
      UI.notify('Initiating FTL jump…', 'warn');
    }

    if (BossManager.isActive) _checkBossPhase();

    if (CombatManager.isVictory()) {
      _combatOutcomeTimer += dt;
      _onCombatVictory();
      if (_combatOutcomeTimer > 2.5) {
        CombatManager.end();
        _enemyShip = null;
        _saveShipToRun();
        _setState(STATE.MAP);
      }
    } else if (CombatManager.isDefeat()) {
      _onCombatDefeat();
    } else if (CombatManager.isFled()) {
      CombatManager.end();
      _enemyShip = null;
      _saveShipToRun();
      UI.notify('FTL jump successful — escaped!', 'good');
      _setState(STATE.MAP);
    }
  }

  // ── Draw ─────────────────────────────────────────────────

  function _draw() {
    const ctx = Renderer.getCtx();
    Renderer.clear();

    switch (_state) {
      case STATE.MENU:
        Renderer.drawMainMenu(_menuHover);
        break;

      case STATE.MAP:
        Renderer.drawBackground(0);
        Renderer.drawMapScreen(_sectorMap, _mapHoverNode);
        break;

      case STATE.COMBAT:
        Renderer.drawBackground(_prevTime * 0.01);
        if (_playerShip) _playerShip.draw(ctx);
        if (_enemyShip)  _enemyShip.draw(ctx);
        CombatManager.draw(ctx);
        CombatManager.drawBeams(ctx);
        Particles.draw(ctx, 1);
        Renderer.drawHUD({ playerShip: _playerShip, enemyShip: _enemyShip });
        _drawCombatButtons(ctx);
        if (CombatManager.state === 'retreating') {
          Renderer.drawRetreatBar(CombatManager._retreatTimer / 3.0);
        }
        break;

      case STATE.EVENT:
        Renderer.drawBackground(0);
        if (_currentEvent) Renderer.drawEventPopup(_currentEvent);
        break;

      case STATE.STATION:
        Renderer.drawBackground(0);
        Renderer.drawHUD({ playerShip: _playerShip });
        break;

      case STATE.OUTCOME:
        Renderer.drawBackground(0);
        Renderer.drawOutcome(_outcomeType, _outcomeScrap);
        break;
    }

    UI.draw(ctx, { playerShip: _playerShip });
    if (_paused) _drawPause(ctx);
  }

  function _drawCombatButtons(ctx) {
    if (!_playerShip) return;
    const W = Renderer.getWidth(), H = Renderer.getHeight();

    // Weapon buttons — registered fresh each frame is intentional here
    // because armed state changes; we clear+re-register in setState for menu,
    // but for combat buttons we use a different approach: check click in update
    _playerShip.weapons.forEach((w, i) => {
      if (!w) return;
      const bx = W/2 - 200 + i * 100, by = H - 72, bw = 90, bh = 30;

      ctx.fillStyle = w.armed ? 'rgba(26,255,140,0.25)' : 'rgba(13,17,32,0.85)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();
      ctx.strokeStyle = w.armed ? '#1aff8c' : '#1e2d4a';
      ctx.lineWidth   = w.armed ? 1.5 : 1; ctx.stroke();

      ctx.fillStyle = w.armed ? '#1aff8c' : '#4a6080';
      ctx.font      = '7px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`[${i+1}] ${w.label}`, bx + bw/2, by + 14);

      ctx.fillStyle = '#0a1010';
      ctx.fillRect(bx + 4, by + 18, bw - 8, 6);
      ctx.fillStyle = w.armed ? '#1aff8c' : '#1a8cff';
      ctx.fillRect(bx + 4, by + 18, (bw - 8) * w.charge, 6);

      // Register click — cleared when leaving combat via _setState
      Input.onCanvasClick({ x: bx, y: by, w: bw, h: bh }, () => {
        if (CombatManager.isActive()) CombatManager.playerFire(w);
      });
    });

    // Retreat button
    const rx = W/2 - 60, ry = H - 35;
    ctx.fillStyle = 'rgba(13,17,32,0.85)';
    ctx.beginPath(); ctx.roundRect(rx, ry, 120, 26, 4); ctx.fill();
    ctx.strokeStyle = '#ff7c20'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ff7c20';
    ctx.font      = '8px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('RETREAT [R]', W/2, ry + 17);

    Input.onCanvasClick({ x: rx, y: ry, w: 120, h: 26 }, () => {
      if (CombatManager.isActive()) {
        CombatManager.initiateRetreat(1);
        UI.notify('Initiating FTL jump…', 'warn');
      }
    });
  }

  function _drawPause(ctx) {
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    ctx.fillStyle = 'rgba(7,8,15,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.shadowBlur  = 20;
    ctx.shadowColor = '#1a8cff';
    ctx.fillStyle   = '#4db8ff';
    ctx.font        = '48px Orbitron, monospace';
    ctx.textAlign   = 'center';
    ctx.fillText('PAUSED', W/2, H/2);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#4a6080';
    ctx.font        = '10px Share Tech Mono, monospace';
    ctx.fillText('Press P to resume', W/2, H/2 + 40);
  }

  return { init };

})();

// ── Boot ──────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  Game.init().catch(err => console.error('[Game] Fatal:', err));
});

window.addEventListener('pointerdown', () => Audio.resume(), { once: true });
