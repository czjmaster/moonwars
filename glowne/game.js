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

  let _menuHover   = null;
  let _mapHover    = null;

  let _combatTimer = 0;
  let _combatFired = false;
  let _selectedWeapon = null;   // weapon awaiting a target room

  // ── Boot ──────────────────────────────────────────────────
  async function init() {
    const canvas = document.getElementById('game-canvas');
    Renderer.init(canvas);
    Input.init(canvas);
    Audio.init();
    Save.load();

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
    UI.update(dt);
    Camera.update(dt);
    Particles.update(dt);

    if (STATE === 'menu')    _updateMenu(dt);
    if (STATE === 'map')     _updateMap(dt);
    if (STATE === 'combat')  _updateCombat(dt);
    if (STATE === 'outcome') _updateOutcome(dt);
    if (STATE === 'station') { if (_playerShip) _playerShip.update(dt); }
  }

  // ── Draw ──────────────────────────────────────────────────
  function _draw() {
    const ctx = Renderer.getCtx();
    Renderer.clear();

    if (STATE === 'menu')    _drawMenu(ctx);
    if (STATE === 'map')     _drawMap(ctx);
    if (STATE === 'combat')  _drawCombat(ctx);
    if (STATE === 'event')   _drawEvent(ctx);
    if (STATE === 'station') _drawStation(ctx);
    if (STATE === 'outcome') _drawOutcome(ctx);

    UI.draw(ctx, { playerShip: _playerShip });
    if (_paused) _drawPause(ctx);
  }

  // ── MENU ──────────────────────────────────────────────────
  function _updateMenu() {
    const mx = Input.mouse.x, my = Input.mouse.y;
    const W  = Renderer.getWidth(), H = Renderer.getHeight();
    const cx = W / 2;
    _menuHover = null;
    ['NEW GAME','CONTINUE','GRAVEYARD'].forEach((lbl, i) => {
      if (Utils.pointInRect(mx, my, cx-100, H/2-20+i*56, 200, 40)) _menuHover = i;
    });

    if (Input.mouse.leftPressed && _menuHover !== null) {
      Audio.resume();
      Audio.sfx.uiClick();
      if (_menuHover === 0) _startNewRun();
      if (_menuHover === 1) _continueRun();
      if (_menuHover === 2) UI.showGraveyard();
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

    ['NEW GAME','CONTINUE','GRAVEYARD'].forEach((lbl, i) => {
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

  // ── MAP ───────────────────────────────────────────────────
  function _updateMap(dt) {
    if (_playerShip) _playerShip.update(dt);
    if (Input.mouse.leftPressed) {
      _handlePowerBarClick();
      const doorHit = _handleDoorClick();
      // Crew movement on map screen too
      if (!doorHit) {
        const sel = UI.getSelectedCrew();
        if (sel && _playerShip) {
          const wx = Input.mouse.x, wy = Input.mouse.y;
          if (_playerShip.rooms.some(r => r.contains(wx, wy))) sel.moveToOnShip(_playerShip, wx, wy);
        }
      }
    }

    // Hover detection
    const mx = Input.mouse.x, my = Input.mouse.y;
    const ox = (Renderer.getWidth()  - 700) / 2;
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

  function _drawMap(ctx) {
    Renderer.drawBackground(0);
    Renderer.drawMapScreen(_sectorMap, _mapHover);
    Renderer.drawHUD({ playerShip: _playerShip });
  }

  /** Click near a door toggles it (interior: auto→open→closed; airlock: closed↔open) */
  function _handleDoorClick() {
    if (!_playerShip) return false;
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (const d of _playerShip.doors) {
      if (Utils.dist(mx, my, d.x, d.y) < 16) {
        d.toggle();
        if (d.isAirlock && d.open) UI.notify('Airlock OPEN — venting!', 'warn');
        return true;
      }
    }
    return false;
  }

  /** Handle clicks on the FTL-style bottom power bar (pips + weapons) */
  function _handlePowerBarClick() {
    if (!_playerShip) return;
    const zones = Renderer.getPowerClickZones();
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (const z of zones) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      if (z.system !== undefined) {
        const sys = _playerShip.getSystem(z.system);
        if (!sys) return;
        // Clicking a lit pip removes power down to that pip;
        // clicking an unlit pip adds power up to that pip.
        const target = z.pip < sys.power ? z.pip : z.pip + 1;
        _playerShip.setPower(z.system, target);
        return;
      }
      if (z.weapon !== undefined) {
        const w = _playerShip.weapons[z.weapon];
        if (w && w.armed && CombatManager.isActive()) {
          // Select weapon — next click on an enemy room fires at it
          _selectedWeapon = (_selectedWeapon === w) ? null : w;
          Audio.sfx.uiClick();
          if (_selectedWeapon) UI.notify(`${w.label} — click enemy room to target`, 'info');
        }
        return;
      }
      if (z.crewIndex !== undefined) {
        const c = _playerShip.crew[z.crewIndex];
        if (c) {
          // Toggle selection
          if (UI.getSelectedCrew() === c) UI.deselectCrew();
          else UI.selectCrew(c);
        }
        return;
      }
    }
  }

  function _travelTo(nodeId) {
    if (!_sectorMap || !_sectorMap.travelTo(nodeId)) return;
    Audio.sfx.uiClick();
    const node = _sectorMap.getNode(nodeId);
    _sectorMap.unlockNext();
    _saveShip();

    const t = node.type;
    if (t === 'combat' || t === 'elite') {
      _spawnEnemy(t === 'elite' ? 'hard' : 'normal');
      STATE = 'combat';
      _combatTimer = 0;
      _combatFired = false;
      CombatManager.begin(_playerShip, _enemyShip, _difficulty());
      Audio.resume(); Audio.playMusic('combat');
    } else if (t === 'store') {
      _station = new Station(Save.getRun()?.sector ?? 1, Date.now());
      STATE = 'station';
      UI.openStation(_station, _playerShip);
    } else if (t === 'event' && node.event) {
      _event = node.event;
      STATE = 'event';
    } else if (t === 'exit') {
      _nextSector();
    } else if (t === 'boss') {
      _enemyShip = BossManager.start(0, 850, 120);
      STATE = 'combat';
      _combatTimer = 0;
      _combatFired = false;
      CombatManager.begin(_playerShip, _enemyShip, 'boss');
      Audio.resume(); Audio.playMusic('boss');
      UI.notify('WARNING: MOTHERSHIP', 'alert');
    } else {
      UI.notify('Path clear.', 'info');
    }
  }

  // ── COMBAT ────────────────────────────────────────────────
  function _updateCombat(dt) {
    if (!_playerShip || !_enemyShip) return;
    _playerShip.update(dt);
    _enemyShip.update(dt);
    CombatManager.update(dt);

    // Weapon hotkeys — select weapon (then click enemy room), double-tap = fire random
    ['Digit1','Digit2','Digit3','Digit4'].forEach((code, i) => {
      if (Input.isPressed(code)) {
        const w = _playerShip.weapons[i];
        if (w && w.armed) {
          if (_selectedWeapon === w) {
            CombatManager.playerFire(w);         // second press = fire at random room
            _selectedWeapon = null;
          } else {
            _selectedWeapon = w;
            UI.notify(`${w.label} — click enemy room`, 'info');
          }
        }
      }
    });

    // Targeted fire: selected weapon + click on enemy room
    if (_selectedWeapon && Input.mouse.leftPressed && _enemyShip) {
      const wx = Input.mouse.x, wy = Input.mouse.y;
      const room = _enemyShip.rooms.find(r => r.contains(wx, wy));
      if (room) {
        CombatManager.playerFire(_selectedWeapon, room);
        _selectedWeapon = null;
      }
    }
    // Clear selection if weapon lost charge
    if (_selectedWeapon && !_selectedWeapon.armed) _selectedWeapon = null;

    // Power pips + weapon cards (bottom bar click zones)
    if (Input.mouse.leftPressed) {
      _handlePowerBarClick();
      // Retreat button
      if (Utils.pointInRect(Input.mouse.x, Input.mouse.y, Renderer.getWidth()-150, 50, 130, 30)) {
        CombatManager.initiateRetreat(1);
        UI.notify('FTL jump initiated…', 'warn');
      }
    }
    if (Input.isPressed('KeyR')) {
      CombatManager.initiateRetreat(1);
      UI.notify('FTL jump initiated…', 'warn');
    }

    // Door toggle (takes priority over crew move)
    let doorClicked = false;
    if (Input.mouse.leftPressed) doorClicked = _handleDoorClick();

    // Crew click-to-move
    if (Input.mouse.leftPressed && !doorClicked) {
      const sel = UI.getSelectedCrew();
      if (sel) {
        const wx = Input.mouse.x, wy = Input.mouse.y;
        if (_playerShip.rooms.some(r => r.contains(wx, wy))) sel.moveToOnShip(_playerShip, wx, wy);
      }
    }


    // Outcomes
    if (CombatManager.isVictory()) {
      _combatTimer += dt;
      if (!_combatFired) { _combatFired = true; _onWin(); }
      if (_combatTimer > 2.5) { CombatManager.end(); _enemyShip = null; _selectedWeapon = null; _saveShip(); STATE = 'map'; Audio.playMusic('explore'); }
    }
    if (CombatManager.isDefeat()) { _onLose(); }
    if (CombatManager.isFled()) {
      CombatManager.end(); _enemyShip = null; _saveShip();
      UI.notify('Escaped!', 'good'); STATE = 'map'; Audio.playMusic('explore');
    }
  }

  function _drawCombat(ctx) {
    Renderer.drawBackground(_prevTime * 0.008);
    if (_playerShip) _playerShip.draw(ctx);
    if (_enemyShip)  _enemyShip.draw(ctx);
    CombatManager.draw(ctx);
    CombatManager.drawBeams(ctx);
    Particles.draw(ctx, 1);
    Renderer.drawHUD({ playerShip: _playerShip, enemyShip: _enemyShip });

    // Retreat button (top right)
    {
      const W = Renderer.getWidth();
      ctx.fillStyle = 'rgba(13,17,32,0.85)';
      ctx.beginPath(); ctx.roundRect(W-150, 50, 130, 30, 4); ctx.fill();
      ctx.strokeStyle = '#ff7c20'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#ff7c20';
      ctx.font = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('RETREAT [R]', W-85, 70);
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

    if (result.scrap) {
      const amt = Array.isArray(result.scrap) ? Utils.randInt(result.scrap[0], result.scrap[1]) : result.scrap;
      Save.updateRun({ scrap: Math.max(0, run.scrap + amt) });
      UI.notify((amt>=0?'+':'')+`⬡${amt} scrap`, amt>=0?'good':'warn');
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
      UI.notify(`${c.name} joined!`, 'good');
    }
    if (result.risk === 'crew_damage' && _playerShip?.crew.length > 0) {
      const target = Utils.pick(_playerShip.crew.filter(c=>!c.dead));
      if (target) { const dmg=Utils.randInt(10,40); target.takeDamage(dmg,'boarding'); UI.notify(`${target.name} took ${dmg} dmg!`,'alert'); }
    }
    if (result.combat) {
      _event = null;
      _spawnEnemy(result.combat);
      STATE = 'combat'; _combatTimer=0; _combatFired=false;
      CombatManager.begin(_playerShip, _enemyShip, _difficulty());
      return;
    }
    _event = null;
    STATE = 'map';
  }

  // ── STATION ───────────────────────────────────────────────
  function _drawStation(ctx) {
    Renderer.drawBackground(0);
    Renderer.drawHUD({ playerShip: _playerShip });
    // Station DOM overlay is handled by UI.openStation
    // Check if station closed
    const stEl = document.getElementById('station-screen');
    if (stEl && !stEl.classList.contains('visible')) {
      STATE = 'map';
      Audio.playMusic('explore');
    }
  }

  // ── OUTCOME ───────────────────────────────────────────────
  function _updateOutcome(dt) {
    _outcomeTimer += dt;
    if (_outcomeTimer > 1.0 && (Input.isPressed('Space') || Input.mouse.leftPressed)) {
      STATE = 'menu';
    }
  }

  function _drawOutcome(ctx) {
    Renderer.drawBackground(0);
    Renderer.drawOutcome(_outcomeType, _outcomeScrap);
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

  // ── Helpers ───────────────────────────────────────────────
  function _startNewRun() {
    Save.startRun();
    const run = Save.getRun();
    _playerShip = new Ship('frigate', true, 180, 180);
    makeStartingCrew().forEach(c => _playerShip.addCrew(c));
    _sectorMap = new SectorMap(run.sector, run.seed);
    STATE = 'map';
    Audio.playMusic('explore');
  }

  function _continueRun() {
    if (!Save.hasActiveRun()) { UI.notify('No saved run.','warn'); return; }
    const run = Save.getRun();
    if (!run?.ship) { _startNewRun(); return; }
    _playerShip = Ship.deserialise(run.ship, true, 180, 180);
    (run.crew||[]).forEach(cd => _playerShip.addCrew(CrewMember.deserialise(cd)));
    _sectorMap = new SectorMap(run.sector, run.seed);
    STATE = 'map';
    Audio.playMusic('explore');
  }

  function _spawnEnemy(difficulty='normal') {
    _enemyShip = new Ship('enemy_frigate', false, 850, 200);
    const sector = Save.getRun()?.sector ?? 1;
    _enemyShip.hull += (sector-1)*3; _enemyShip.hullMax += (sector-1)*3;

    // Sector 1: weak starter enemies — NO shields, low hull, small reactor
    if (sector === 1) {
      _enemyShip.hull    = Math.max(8, _enemyShip.hull - 8);
      _enemyShip.hullMax = _enemyShip.hull;
      _enemyShip.reactor.level = 4;
      const sh = _enemyShip.getSystem('shields');
      if (sh) { sh.power = 0; sh.level = 1; sh._shieldBars = 0; }
      _enemyShip._allocateDefaultPower();
      const sh2 = _enemyShip.getSystem('shields');
      if (sh2) sh2.power = 0;   // keep shields dark even after realloc
    }

    makeEnemyCrew(sector === 1 ? 2 : 2+Math.floor(sector/2)).forEach(c=>_enemyShip.addCrew(c));
    if (difficulty==='hard' && sector>=3) try { _enemyShip.installWeapon('laser_burst',1); } catch(e){}
  }

  function _difficulty() {
    const s = Save.getRun()?.sector ?? 1;
    return s>=6?'hard':s>=3?'normal':'easy';
  }

  function _nextSector() {
    const run = Save.getRun(); if (!run) return;
    const next = run.sector+1;
    if (next>8) { _outcomeType='victory'; _outcomeScrap=run.scrap; Save.endRun(true); Save.addScrapBank(Math.floor(run.scrap*0.5)); STATE='outcome'; _outcomeTimer=0; return; }
    Save.updateRun({ sector:next, nodeIndex:0, seed:Math.floor(Math.random()*1e9) });
    _sectorMap = new SectorMap(next, Save.getRun().seed);
    UI.notify(`Entering Sector ${next}`,'good');
    STATE='map';
  }

  function _onWin() {
    const reward = CombatManager.scrapReward;
    const run = Save.getRun();
    if (run) Save.updateRun({ scrap: run.scrap+reward });
    UI.notify(`+⬡${reward} scrap`,'good');
    Audio.sfx.scrapCollect();
    _playerShip?.crew.forEach(c=>c.addXP('combat',15));
    if (CombatManager.weaponDrop) {
      const slot = _playerShip?.weapons.findIndex(w=>!w)??-1;
      if (slot!==-1) { _playerShip.installWeapon(CombatManager.weaponDrop,slot); UI.notify(`Weapon recovered!`,'good'); }
    }
  }

  function _onLose() {
    _outcomeType='defeat'; _outcomeScrap=0;
    Save.endRun(false); Audio.stopMusic(1.0);
    STATE='outcome'; _outcomeTimer=0;
  }

  function _saveShip() {
    if (!_playerShip) return;
    Save.updateRun({ ship:_playerShip.serialise(), crew:_playerShip.crew.map(c=>c.serialise()) });
  }

  return { init };
})();

window.addEventListener('DOMContentLoaded', () => {
  Game.init().catch(err => console.error('[Game] Fatal:', err));
});
window.addEventListener('pointerdown', () => Audio.resume(), { once: true });
