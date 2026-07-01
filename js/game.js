/* ============================================================
   MOON WARS — game.js
   Main entry point. Game state machine + main loop.
   States: LOADING → MENU → MAP → COMBAT → EVENT → STATION
           → VICTORY → DEFEAT → GRAVEYARD
   ============================================================ */

'use strict';

const Game = (() => {

  // ── Game states ──────────────────────────────────────────

  const STATE = {
    LOADING:  'loading',
    MENU:     'menu',
    MAP:      'map',
    COMBAT:   'combat',
    EVENT:    'event',
    STATION:  'station',
    OUTCOME:  'outcome',   // victory or defeat screen
  };

  // ── Runtime ──────────────────────────────────────────────

  let _state       = STATE.LOADING;
  let _prevTime    = 0;
  let _paused      = false;
  let _rafId       = null;

  // Game world objects
  let _playerShip  = null;
  let _enemyShip   = null;
  let _sectorMap   = null;
  let _station     = null;
  let _currentEvent = null;

  // UI hover state
  let _menuHover   = null;
  let _mapHoverNode = null;

  // Outcome state
  let _outcomeType  = null;   // 'victory' | 'defeat'
  let _outcomeScrap = 0;
  let _outcomeTimer = 0;

  // Combat: post-outcome wait
  let _combatOutcomeTimer = 0;

  // ── Init ────────────────────────────────────────────────

  async function init() {
    const canvas = document.getElementById('game-canvas');

    // Order matters: renderer first (sets canvas size), then input
    Renderer.init(canvas);
    Input.init(canvas);
    Audio.init();
    Save.load();

    // Apply saved volume settings
    const settings = Save.getSettings();
    Audio.setMasterVolume(settings.masterVolume ?? 0.8);
    Audio.setSfxVolume(settings.sfxVolume ?? 1.0);
    Audio.setMusicVolume(settings.musicVolume ?? 0.35);

    // Load all procedural sprites
    Utils.setLoadingProgress(5, 'Generating sprites…');
    await Assets.init((pct, msg) => {
      Utils.setLoadingProgress(10 + pct * 70, msg);
    });

    // Init animation frames
    Utils.setLoadingProgress(82, 'Animating crew…');
    Animation.init();

    Utils.setLoadingProgress(95, 'Calibrating systems…');
    await _sleep(200);

    Utils.setLoadingProgress(100, 'Ready.');
    await _sleep(400);

    Utils.hideLoadingScreen();

    // Register menu buttons
    Renderer.onMenuButton('new_game',  startNewRun);
    Renderer.onMenuButton('continue',  continueRun);
    Renderer.onMenuButton('graveyard', () => UI.showGraveyard());
    Renderer.onMenuButton('settings',  () => { /* TODO: settings modal */ });

    _setState(STATE.MENU);
    Audio.resume();
    _loop(0);
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── State transitions ────────────────────────────────────

  function _setState(newState) {
    _state = newState;
    Input.clearCanvasListeners();
    _mapHoverNode  = null;
    _currentEvent  = null;

    switch (newState) {
      case STATE.MENU:
        Audio.playMusic('explore');
        _playerShip = null;
        _enemyShip  = null;
        break;

      case STATE.MAP:
        Audio.playMusic('explore');
        _rebuildMapHitAreas();
        break;

      case STATE.COMBAT:
        // Ships already set before transition
        CombatManager.begin(_playerShip, _enemyShip, _combatDifficulty());
        _registerCombatInput();
        break;

      case STATE.EVENT:
        _registerEventInput();
        break;

      case STATE.STATION:
        UI.openStation(_station, _playerShip);
        break;

      case STATE.OUTCOME:
        _outcomeTimer = 0;
        break;
    }
  }

  // ── New run / continue ───────────────────────────────────

  function startNewRun() {
    Save.startRun();
    const run = Save.getRun();

    // Build player ship
    _playerShip = new Ship('frigate', true, 60, 160);
    const crew  = makeStartingCrew();
    crew.forEach(c => _playerShip.addCrew(c));

    // Build first sector map
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
    run.crew.forEach(cd => {
      _playerShip.addCrew(CrewMember.deserialise(cd));
    });

    _sectorMap = new SectorMap(run.sector, run.seed);
    _setState(STATE.MAP);
  }

  // ── Map navigation ───────────────────────────────────────

  function _rebuildMapHitAreas() {
    if (!_sectorMap) return;
    Input.clearCanvasListeners();

    const ox = (Renderer.getWidth()  - 700) / 2;
    const oy = (Renderer.getHeight() - 400) / 2;
    const R  = 18;

    _sectorMap.nodes.forEach(node => {
      if (node.locked) return;
      const nx = node.x + ox, ny = node.y + oy;
      Input.onCanvasClick({ x: nx-R, y: ny-R, w: R*2, h: R*2 }, () => {
        _travelToNode(node.id);
      });
    });
  }

  function _travelToNode(nodeId) {
    if (!_sectorMap.travelTo(nodeId)) return;
    Audio.sfx.uiClick();

    const node = _sectorMap.getNode(nodeId);
    _sectorMap.unlockNext();
    _rebuildMapHitAreas();

    // Save current ship state
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
          _setState(STATE.MAP);
        }
        break;

      case 'exit':
        _advanceSector();
        break;

      case 'boss':
        _startBoss();
        break;

      case 'empty':
      case 'nebula':
        // Nothing — just move to next map node
        UI.notify('Sector clear.', 'info');
        _setState(STATE.MAP);
        break;
    }
  }

  function _advanceSector() {
    const run = Save.getRun();
    if (!run) return;
    const nextSector = run.sector + 1;

    if (nextSector > 8) {
      // Final victory
      _outcomeType  = 'victory';
      _outcomeScrap = run.scrap;
      Save.endRun(true);
      Save.addScrapBank(Math.floor(run.scrap * 0.5));
      _setState(STATE.OUTCOME);
      return;
    }

    Save.updateRun({ sector: nextSector, nodeIndex: 0, seed: Math.floor(Math.random()*1e9) });
    _sectorMap = new SectorMap(nextSector, Save.getRun().seed);
    UI.notify(`Entering Sector ${nextSector}`, 'good');
    _setState(STATE.MAP);
  }

  // ── Enemy spawn ──────────────────────────────────────────

  function _spawnEnemy(difficulty = 'normal') {
    _enemyShip = new Ship('enemy_frigate', false, 820, 160);

    // Scale enemy to sector
    const sector = Save.getRun()?.sector ?? 1;
    const extraHull = (sector - 1) * 3;
    _enemyShip.hull    += extraHull;
    _enemyShip.hullMax += extraHull;

    // Add enemy crew
    const crew = makeEnemyCrew(2 + Math.floor(sector / 2));
    crew.forEach(c => _enemyShip.addCrew(c));

    // Extra weapon for harder encounters
    if (difficulty === 'hard' && sector >= 3) {
      try { _enemyShip.installWeapon('laser_burst', 1); } catch(e) {}
    }
  }

  let _bossPhase = 0;

  function _startBoss() {
    _bossPhase = 0;
    const ship = BossManager.start(_bossPhase, 820, 80);
    _enemyShip = ship;
    _setState(STATE.COMBAT);
    Audio.sfx.bossWarning();
    UI.notify('WARNING: MOTHERSHIP DETECTED', 'alert');
  }

  function _combatDifficulty() {
    const sector = Save.getRun()?.sector ?? 1;
    if (sector >= 6) return 'hard';
    if (sector >= 3) return 'normal';
    return 'easy';
  }

  // ── Combat input ─────────────────────────────────────────

  function _registerCombatInput() {
    // Weapon fire buttons registered per-frame in drawHUD
    // Retreat button
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    Input.onCanvasClick({ x: W/2 - 60, y: H - 44, w: 120, h: 30 }, () => {
      if (CombatManager.isActive()) {
        CombatManager.initiateRetreat(1);
        UI.notify('Initiating FTL jump…', 'warn');
      }
    });
  }

  // ── Event input ───────────────────────────────────────────

  function _registerEventInput() {
    if (!_currentEvent) return;
    _currentEvent.choices.forEach((c, i) => {
      Renderer.onEventChoice(i, () => _resolveEventChoice(i));
    });
  }

  function _resolveEventChoice(idx) {
    if (!_currentEvent) return;
    const choice = _currentEvent.choices[idx];
    if (!choice) return;

    const result = choice.result;
    const run    = Save.getRun();
    if (!run) return;

    // Scrap
    if (result.scrap) {
      const amt = Array.isArray(result.scrap)
        ? Utils.randInt(result.scrap[0], result.scrap[1])
        : result.scrap;
      Save.updateRun({ scrap: Math.max(0, run.scrap + amt) });
      if (amt > 0) { UI.notify(`+⬡${amt} scrap`, 'good'); Audio.sfx.scrapCollect(); }
      else if (amt < 0) { UI.notify(`-⬡${Math.abs(amt)} scrap`, 'warn'); }
    }

    // Fuel
    if (result.fuel) {
      const amt = Array.isArray(result.fuel)
        ? Utils.randInt(result.fuel[0], result.fuel[1])
        : result.fuel;
      Save.updateRun({ fuel: run.fuel + amt });
      UI.notify(`+${amt} fuel`, 'good');
    }

    // Missiles
    if (result.missiles) {
      const amt = Array.isArray(result.missiles)
        ? Utils.randInt(result.missiles[0], result.missiles[1])
        : result.missiles;
      Save.updateRun({ missiles: run.missiles + amt });
      UI.notify(`+${amt} missiles`, 'good');
    }

    // Crew gain
    if (result.crew) {
      if (_playerShip && _playerShip.crew.length < 8) {
        const newCrew = new CrewMember({});
        _playerShip.addCrew(newCrew);
        UI.notify(`${newCrew.name} joined the crew!`, 'good');
      }
    }

    // Crew damage risk
    if (result.risk === 'crew_damage' && _playerShip) {
      const target = Utils.pick(_playerShip.crew.filter(c => !c.dead));
      if (target) {
        const dmg = Utils.randInt(10, 40);
        target.takeDamage(dmg, 'boarding');
        UI.notify(`${target.name} took ${dmg} damage!`, 'alert');
      }
    }

    // System upgrade
    if (result.system_upgrade && result.cost) {
      const cost = result.cost;
      if (run.scrap >= cost) {
        Save.updateRun({ scrap: run.scrap - cost });
        const sys = _playerShip?.getSystem(result.system_upgrade);
        if (sys && sys.upgrade()) {
          UI.notify(`${sys.label} upgraded!`, 'good');
        }
      } else {
        UI.notify('Insufficient scrap.', 'warn');
      }
    }

    // Trigger combat
    if (result.combat) {
      _currentEvent = null;
      _spawnEnemy(result.combat);
      _setState(STATE.COMBAT);
      return;
    }

    _currentEvent = null;
    _setState(STATE.MAP);
  }

  // ── Boss phase handling ───────────────────────────────────

  function _checkBossPhase() {
    if (!BossManager.isActive) return;
    const result = BossManager.update(0);

    if (result === 'next_phase') {
      CombatManager.end();
      UI.notify(`MOTHERSHIP PHASE ${BossManager.phase + 1}`, 'alert');
      _enemyShip = BossManager.nextPhase(820, 80);
      CombatManager.begin(_playerShip, _enemyShip, 'boss');
      _registerCombatInput();
    } else if (result === 'defeated') {
      _onCombatVictory();
    }
  }

  // ── Combat resolution ─────────────────────────────────────

  function _onCombatVictory() {
    const reward = CombatManager.scrapReward;
    UI.notify(`+⬡${reward} scrap`, 'good');
    Audio.sfx.scrapCollect();
    Particles.scrapCollect(_playerShip.worldX + 200, _playerShip.worldY + 150);

    // Weapon drop
    if (CombatManager.weaponDrop) {
      const wd = CombatManager.weaponDrop;
      const def = getWeaponDef(wd);
      if (def) UI.notify(`Recovered: ${def.label}`, 'good');
      // Auto-install if slot free, else lose it
      const slot = _playerShip.weapons.findIndex(w => !w);
      if (slot !== -1) _playerShip.installWeapon(wd, slot);
    }

    _combatOutcomeTimer = 0;
  }

  function _onCombatDefeat() {
    _outcomeType  = 'defeat';
    _outcomeScrap = 0;
    Save.endRun(false);
    _setState(STATE.OUTCOME);
    Audio.stopMusic(1.0);
  }

  // ── Save helpers ─────────────────────────────────────────

  function _saveShipToRun() {
    if (!_playerShip) return;
    Save.updateRun({
      ship:  _playerShip.serialise(),
      crew:  _playerShip.crew.map(c => c.serialise()),
    });
  }

  // ── Main loop ────────────────────────────────────────────

  function _loop(timestamp) {
    _rafId = requestAnimationFrame(_loop);

    const dt = Math.min((timestamp - _prevTime) / 1000, 0.05); // cap at 50ms
    _prevTime = timestamp;

    Input.beginFrame();

    // Global keys
    if (Input.isPressed('Escape') || Input.isPressed('KeyP')) {
      if (_state === STATE.COMBAT || _state === STATE.MAP) {
        _paused = !_paused;
      }
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

      case STATE.EVENT:
        // No physics update during event
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

  function _updateMenu() {
    const mx = Input.mouse.x, my = Input.mouse.y;
    const cx = Renderer.getWidth() / 2, cy = Renderer.getHeight() / 2;
    const buttons = ['new_game','continue','graveyard','settings'];
    _menuHover = null;
    buttons.forEach((id, i) => {
      const bx = cx-100, by = cy-40+i*50;
      if (Utils.pointInRect(mx, my, bx, by, 200, 36)) _menuHover = id;
    });
  }

  function _updateMapHover() {
    if (!_sectorMap) return;
    const mx  = Input.mouse.x, my = Input.mouse.y;
    const ox  = (Renderer.getWidth()  - 700) / 2;
    const oy  = (Renderer.getHeight() - 400) / 2;
    const R   = 22;
    _mapHoverNode = null;

    _sectorMap.nodes.forEach(node => {
      if (node.locked) return;
      const nx = node.x + ox, ny = node.y + oy;
      if (Utils.dist(mx, my, nx, ny) < R) {
        _mapHoverNode = node.id;
      }
    });
  }

  function _updateCombat(dt) {
    if (!_playerShip || !_enemyShip) return;

    _playerShip.update(dt);
    _enemyShip.update(dt);
    CombatManager.update(dt);

    // Crew right-click targeting
    const sel = UI.getSelectedCrew();
    if (sel && Input.mouse.leftPressed) {
      // Move selected crew to click position (within player ship bounds)
      const wx = Input.mouse.x, wy = Input.mouse.y;
      const inShip = _playerShip.rooms.some(r => r.contains(wx, wy));
      if (inShip) sel.moveTo(wx, wy);
    }

    // Weapon quick-fire keys (1–4)
    ['Digit1','Digit2','Digit3','Digit4'].forEach((code, i) => {
      if (Input.isPressed(code)) {
        const w = _playerShip.weapons[i];
        if (w && w.armed) CombatManager.playerFire(w);
      }
    });

    // Boss phase check
    if (BossManager.isActive) _checkBossPhase();

    // Check outcome
    if (CombatManager.isVictory()) {
      _combatOutcomeTimer += dt;
      if (_combatOutcomeTimer <= 0.05) _onCombatVictory();  // fire once
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

  // ── Draw ────────────────────────────────────────────────

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
        _drawCombatScene(ctx);
        Renderer.drawHUD({ playerShip: _playerShip, enemyShip: _enemyShip });
        _drawCombatControls(ctx);
        if (CombatManager.state === 'retreating') {
          Renderer.drawRetreatBar(CombatManager._retreatTimer / 3.0);
        }
        break;

      case STATE.EVENT:
        Renderer.drawBackground(0);
        if (_currentEvent) {
          Renderer.drawEventPopup(_currentEvent);
        }
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

    // Particles (above-ship layer)
    if (_state === STATE.COMBAT) Particles.draw(ctx, 1);

    // UI overlay (notifs, tooltips, crew panel)
    UI.draw(ctx, { playerShip: _playerShip });

    // Pause overlay
    if (_paused) _drawPause(ctx);
  }

  function _drawCombatScene(ctx) {
    Renderer.drawCombatLayout(_playerShip, _enemyShip);
    if (_playerShip) _playerShip.draw(ctx);
    if (_enemyShip)  _enemyShip.draw(ctx);
    CombatManager.draw(ctx);
    CombatManager.drawBeams(ctx);
  }

  function _drawCombatControls(ctx) {
    if (!_playerShip) return;
    const W = Renderer.getWidth(), H = Renderer.getHeight();

    // Weapon fire buttons (bottom centre)
    _playerShip.weapons.forEach((w, i) => {
      if (!w) return;
      const bx = W/2 - 200 + i * 100, by = H - 72, bw = 90, bh = 30;
      const armed = w.armed;

      ctx.fillStyle = armed ? 'rgba(26,255,140,0.25)' : 'rgba(13,17,32,0.85)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();
      ctx.strokeStyle = armed ? '#1aff8c' : '#1e2d4a';
      ctx.lineWidth   = armed ? 1.5 : 1;
      ctx.stroke();

      ctx.fillStyle = armed ? '#1aff8c' : '#4a6080';
      ctx.font      = '7px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`[${i+1}] ${w.label}`, bx + bw/2, by + 14);

      // Charge bar
      ctx.fillStyle = '#0a1010';
      ctx.fillRect(bx + 4, by + 18, bw - 8, 6);
      ctx.fillStyle = armed ? '#1aff8c' : '#1a8cff';
      ctx.fillRect(bx + 4, by + 18, (bw - 8) * w.charge, 6);

      // Click to fire
      Input.onCanvasClick({ x:bx, y:by, w:bw, h:bh }, () => {
        CombatManager.playerFire(w);
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

    if (Input.isPressed('KeyR') && CombatManager.isActive()) {
      CombatManager.initiateRetreat(1);
      UI.notify('Initiating FTL jump…', 'warn');
    }
  }

  function _drawPause(ctx) {
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    ctx.fillStyle = 'rgba(7,8,15,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#4db8ff';
    ctx.font      = '48px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur  = 20;
    ctx.shadowColor = '#1a8cff';
    ctx.fillText('PAUSED', W/2, H/2);
    ctx.shadowBlur  = 0;
    ctx.fillStyle = '#4a6080';
    ctx.font      = '10px Share Tech Mono, monospace';
    ctx.fillText('Press P to resume', W/2, H/2 + 40);
  }

  // ── Public API ───────────────────────────────────────────

  return { init };

})();

// ── Boot ─────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  Game.init().catch(err => {
    console.error('[Game] Fatal init error:', err);
  });
});

// Resume audio on first user gesture
window.addEventListener('pointerdown', () => Audio.resume(), { once: true });
