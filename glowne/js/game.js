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

  // FTL-style crew stations: SAVE snapshots current rooms,
  // RETURN sends everyone back. Session-only (not serialised).
  let _savedStations = null;    // Map crewId → roomId

  // Combat pending behind a negotiation dialog + nebula battle flag
  let _pendingCombat  = null;   // { difficulty, nebula }
  let _nebulaCombat   = false;  // both ships fight at −2 reactor power
  let _surrenderAsked = false;  // enemy already offered surrender this fight

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
          const room = _playerShip.rooms.find(r => r.contains(wx, wy));
          if (room) {
            sel.homeRoomId = room.id;
            sel.moveToOnShip(_playerShip, wx, wy);
          }
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

  /** FTL escape rules: working engines + manned working cockpit, never vs boss */
  function _canRetreat() {
    if (BossManager.isActive) {
      UI.notify('Cannot escape the Mothership!', 'alert');
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
        d.toggle();
        if (d.isAirlock && d.open) UI.notify('Airlock OPEN — venting!', 'warn');
        return true;
      }
    }
    return false;
  }

  /** Snapshot every living crew member's current room (FTL "save stations") */
  function _saveStations() {
    if (!_playerShip) return;
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
    if (!_savedStations || !_savedStations.size) {
      UI.notify('No saved positions — use SAVE first', 'warn');
      return;
    }
    let sent = 0;
    _playerShip.crew.forEach(c => {
      if (c.dead || c.dying) return;
      const roomId = _savedStations.get(c.id);
      const room   = roomId ? _playerShip.getRoomById(roomId) : null;
      if (!room) return;
      c.homeRoomId = room.id;            // idle logic keeps them there
      c.moveToOnShip(_playerShip, room.cx, room.cy);
      sent++;
    });
    Audio.sfx.uiClick();
    if (sent) UI.notify('Crew returning to stations', 'info');
  }

  /** Handle clicks on the FTL-style bottom power bar (pips + weapons) */
  function _handlePowerBarClick() {
    if (!_playerShip) return;
    const zones = Renderer.getPowerClickZones();
    const mx = Input.mouse.x, my = Input.mouse.y;
    for (const z of zones) {
      if (!Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) continue;
      if (z.crewSave)   { _saveStations();     return; }
      if (z.crewReturn) { _returnToStations(); return; }
      if (z.sysIndex !== undefined) {
        const sys = _playerShip.systems[z.sysIndex];
        if (!sys) return;
        // Clicking a lit pip removes power down to that pip;
        // clicking an unlit pip adds power up to that pip.
        const target = z.pip < sys.power ? z.pip : z.pip + 1;
        _playerShip.setPowerAt(z.sysIndex, target);
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
      if (z.weaponAuto !== undefined) {
        const w = _playerShip.weapons[z.weaponAuto];
        if (w) {
          w.autoFire = !w.autoFire;
          Audio.sfx.uiClick();
          UI.notify(`${w.label}: AUTO ${w.autoFire ? 'ON' : 'OFF'}`, 'info');
        }
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

    _playerShip.reactor.penalty = 0;   // any lingering nebula effect ends
    _nebulaCombat = false;

    const t = node.type;
    if (t === 'combat' || t === 'elite') {
      const diff = t === 'elite' ? 'hard' : 'normal';
      // Sometimes the hostiles would rather extort than fight
      if (t === 'combat' && Math.random() < 0.35) _maybeNegotiate(diff, false);
      else _startCombat(diff, false);
    } else if (t === 'nebula') {
      // Nebula: sometimes an ambush (fought at −2 power for BOTH sides),
      // sometimes a random event hidden in the clouds.
      if (Math.random() < 0.55) {
        if (Math.random() < 0.3) _maybeNegotiate('normal', true);
        else _startCombat('normal', true);
      } else {
        _event = Utils.pick(EVENTS);
        STATE = 'event';
      }
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
      // Resume at the phase already reached — fleeing and coming back
      // does NOT reset the Mothership to phase I.
      _enemyShip = BossManager.start(BossManager.phase, 850, 120);
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
        // Final boss down = run won
        const run = Save.getRun();
        _outcomeType  = 'victory';
        _outcomeScrap = (run?.scrap ?? 0) + BossManager.scrapReward;
        if (run) Save.updateRun({ scrap: run.scrap + BossManager.scrapReward });
        Save.endRun(true);
        Save.addScrapBank(Math.floor(_outcomeScrap * 0.5));
        CombatManager.end();
        _enemyShip = null;
        STATE = 'outcome'; _outcomeTimer = 0;
        Audio.stopMusic(1.0);
        return;
      }
    }

    CombatManager.update(dt);

    // Badly damaged enemies sometimes beg for mercy, offering tribute
    if (CombatManager.surrenderOffer && !_surrenderAsked) {
      _surrenderAsked = true;
      CombatManager.surrenderOffer = false;
      const run    = Save.getRun();
      const scrap  = Utils.randInt(20, 35 + (run?.sector ?? 1) * 5);
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
        text: `"Cease fire! Take it — just let us live." They offer ⬡${scrap} scrap${extras}.`,
        choices: [
          { label: 'Accept tribute — let them go',
            result: { ...offers[0], acceptSurrender: true } },
          { label: 'No mercy — finish them',
            result: { resumeCombat: true } },
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

    // Power pips + weapon cards (bottom bar click zones)
    if (Input.mouse.leftPressed) {
      _handlePowerBarClick();
      // Retreat button
      if (Utils.pointInRect(Input.mouse.x, Input.mouse.y, Renderer.getWidth()-150, 50, 130, 30)) {
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

    // Door toggle (takes priority over crew move)
    let doorClicked = false;
    if (Input.mouse.leftPressed) doorClicked = _handleDoorClick();

    // Crew click-to-move (FTL: a sent crew member STAYS at the clicked
    // room — home follows the order; RETURN button restores saved posts)
    if (Input.mouse.leftPressed && !doorClicked) {
      const sel = UI.getSelectedCrew();
      if (sel) {
        const wx = Input.mouse.x, wy = Input.mouse.y;
        const room = _playerShip.rooms.find(r => r.contains(wx, wy));
        if (room) {
          sel.homeRoomId = room.id;
          sel.moveToOnShip(_playerShip, wx, wy);
        }
      }
    }


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
        // Final boss down = run won
        const run = Save.getRun();
        _outcomeType  = 'victory';
        _outcomeScrap = (run?.scrap ?? 0) + BossManager.scrapReward;
        if (run) Save.updateRun({ scrap: run.scrap + BossManager.scrapReward });
        Save.endRun(true);
        Save.addScrapBank(Math.floor(_outcomeScrap * 0.5));
        CombatManager.end();
        _enemyShip = null;
        STATE = 'outcome'; _outcomeTimer = 0;
        Audio.stopMusic(1.0);
        return;
      }
    }

    if (CombatManager.isVictory()) {
      _combatTimer += dt;
      if (!_combatFired) {
        _combatFired = true;
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
        _saveShip(); STATE = 'map'; Audio.playMusic('explore');
      }
    }
    if (CombatManager.isDefeat()) { _onLose(); }
    if (CombatManager.isFled()) {
      CombatManager.end(); _enemyShip = null; _saveShip();
      UI.notify('Escaped!', 'good'); STATE = 'map'; Audio.playMusic('explore');
    }
  }

  function _drawCombat(ctx) {
    Renderer.drawBackground(_prevTime * 0.008);

    // Nebula backdrop — drifting violet clouds behind the ships
    if (_nebulaCombat) Renderer.drawNebula(ctx, _prevTime * 0.001);

    if (_playerShip) _playerShip.draw(ctx);
    if (_enemyShip && !_enemyShip.destroyed) _enemyShip.draw(ctx);

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
    if (result.loseCrew && _playerShip && _playerShip.crew.length > 1) {
      const victim = Utils.pick(_playerShip.crew.filter(c => !c.dead));
      if (victim) {
        _playerShip.crew = _playerShip.crew.filter(c => c !== victim);
        Save.addToGraveyard?.(victim.name, 'handed over as tribute');
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
      return;
    }
    if (result.acceptSurrender) {
      _event = null;
      _endCombatPeacefully();
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
  function _endCombatPeacefully() {
    CombatManager.end();
    if (_enemyShip) Particles.floatText(
      _enemyShip.worldX + 150, _enemyShip.worldY + 80, 'SURRENDERED', '#1aff8c', 14);
    _enemyShip = null;
    _playerShip.reactor.penalty = 0;
    _nebulaCombat = false;
    _playerShip.crew.forEach(c => c.addXP('combat', 8));
    STATE = 'map';
    Audio.playMusic('explore');
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
    _savedStations = null;
    BossManager.reset();
    _playerShip = new Ship('frigate', true, 180, 180);
    makeStartingCrew().forEach(c => _playerShip.addCrew(c));
    _playerShip.assignStations();
    _sectorMap = new SectorMap(run.sector, run.seed);
    STATE = 'map';
    Audio.playMusic('explore');
  }

  function _continueRun() {
    if (!Save.hasActiveRun()) { UI.notify('No saved run.','warn'); return; }
    const run = Save.getRun();
    if (!run?.ship) { _startNewRun(); return; }
    _savedStations = null;
    BossManager.reset();
    _playerShip = Ship.deserialise(run.ship, true, 180, 180);
    (run.crew||[]).forEach(cd => _playerShip.addCrew(CrewMember.deserialise(cd)));
    _sectorMap = new SectorMap(run.sector, run.seed);
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
      _enemyShip.hull    = elite ? 14 : 10;
    } else {
      _enemyShip.hull    = (elite ? 20 : 15) + (sector - 2) * 4;
    }
    _enemyShip.hullMax = _enemyShip.hull;

    // ── Shields: ELITE ships have them (lvl ≥ 2). Normal ships have
    //    NO shields MODULE at all — the room stays as an empty,
    //    framed compartment. ──
    const sh = _enemyShip.getSystem('shields');
    if (sh) {
      if (elite) {
        sh.level = sector >= 2 ? 4 : 2;   // sector2 elite: 2 layers
        sh.desiredPower = sh.level;
      } else {
        const room = _enemyShip.getRoomById(sh.roomId);
        if (room) { room.system = null; room.type = 'empty'; }
        _enemyShip.systems = _enemyShip.systems.filter(s => s !== sh);
      }
    }

    // ── Weapons: 2nd gun ONLY if the hull has a 2nd weapon module ──
    if (_enemyShip.weaponRooms.length > 1 && (elite || sector >= 2)) {
      _enemyShip.installWeapon(elite && sector >= 2 ? 'laser_heavy' : 'laser_basic', 1);
    }
    // Each weapon MODULE covers its own gun's power cost
    _enemyShip.weapons.forEach((w, i) => {
      if (!w) return;
      const sys = _enemyShip.weaponSystemFor(i);
      if (!sys) return;
      sys.level        = Math.min(8, Math.max(sys.level, w.powerCost));
      sys.desiredPower = sys.level;
    });

    // ── Reactor MODULE level (1-8, each = 2 power) ──
    // normal: lvl 4 (8 power) · elite: lvl 6 (12) · late elite: lvl 8 (16)
    _enemyShip.reactor.level =
      sector === 1 ? (elite ? 6 : 4) : (elite ? 8 : 6);
    _enemyShip._allocateDefaultPower();

    makeEnemyCrew(sector === 1 ? 2 : 3).forEach(c=>_enemyShip.addCrew(c));
    _enemyShip.assignStations();
  }

  /** Start combat vs a fresh enemy. In a nebula BOTH ships run at −2 power. */
  function _startCombat(difficulty, nebula = false) {
    _spawnEnemy(difficulty);
    _nebulaCombat   = nebula;
    _surrenderAsked = false;
    _playerShip.reactor.penalty = nebula ? 2 : 0;
    _enemyShip.reactor.penalty  = nebula ? 2 : 0;
    _playerShip._allocateDefaultPower();
    _enemyShip._allocateDefaultPower();
    _playerShip.weapons.forEach(w => { if (w) w.targetRoom = null; });
    STATE = 'combat'; _combatTimer = 0; _combatFired = false;
    CombatManager.begin(_playerShip, _enemyShip, difficulty === 'hard' ? 'hard' : _difficulty());
    Audio.resume(); Audio.playMusic('combat');
    if (nebula) UI.notify('NEBULA — both ships at −2 power', 'warn');
  }

  /** 35%: hostiles hail you and demand tribute instead of fighting */
  function _maybeNegotiate(difficulty, nebula) {
    const run = Save.getRun();
    const toll = 15 + (run?.sector ?? 1) * 10;
    const choices = [
      { label: `Pay ⬡${toll} scrap tribute`, result: { scrap: -toll } },
    ];
    if (_playerShip.crew.length > 1) {
      choices.push({ label: 'Hand over a crew member', result: { loseCrew: true } });
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

  function _difficulty() {
    const s = Save.getRun()?.sector ?? 1;
    return s>=6?'hard':s>=3?'normal':'easy';
  }

  function _nextSector() {
    const run = Save.getRun(); if (!run) return;
    const next = run.sector+1;
    if (next>3) { _outcomeType='victory'; _outcomeScrap=run.scrap; Save.endRun(true); Save.addScrapBank(Math.floor(run.scrap*0.5)); STATE='outcome'; _outcomeTimer=0; return; }
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
    if (CombatManager.weaponDrop && _playerShip) {
      // Install into a free weapon MODULE, otherwise stash it in cargo
      let slot = -1;
      for (let i = 0; i < _playerShip.weaponRooms.length; i++) {
        if (!_playerShip.weapons[i]) { slot = i; break; }
      }
      if (slot !== -1 && _playerShip.installWeapon(CombatManager.weaponDrop, slot)) {
        UI.notify('Weapon recovered and installed!', 'good');
      } else {
        _playerShip.weaponCargo.push(CombatManager.weaponDrop);
        UI.notify('Weapon recovered → cargo (fit it at a station)', 'good');
      }
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
