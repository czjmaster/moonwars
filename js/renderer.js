/* ============================================================
   MOON WARS — renderer.js
   Main canvas rendering pipeline.
   Owns the canvas, manages resolution, orchestrates all
   draw calls in correct layer order.
   ============================================================ */

'use strict';

const Renderer = (() => {

  let _canvas  = null;
  let _ctx     = null;
  let _W       = 1280;
  let _H       = 720;
  let _pixelRatio = 1;

  // Parallax star layers
  const _starLayers = [
    { speed: 0.05, alpha: 0.6 },
    { speed: 0.12, alpha: 0.8 },
  ];
  let _starOffset = 0;

  // ── Init ────────────────────────────────────────────────

  function init(canvasEl) {
    _canvas = canvasEl;
    _ctx    = _canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);
    return _ctx;
  }

  function _resize() {
    const winW  = window.innerWidth;
    const winH  = window.innerHeight;
    const scale = Math.min(winW / _W, winH / _H);

    _canvas.style.width  = Math.round(_W * scale) + 'px';
    _canvas.style.height = Math.round(_H * scale) + 'px';
    _canvas.width        = _W;
    _canvas.height       = _H;

    // Inform input system of CSS→canvas scale
    const rect = _canvas.getBoundingClientRect();
    Input.setScale(
      rect.width  / _W || 1,
      rect.height / _H || 1
    );

    Camera.resize(_W, _H);
  }

  function getCtx()    { return _ctx; }
  function getWidth()  { return _W; }
  function getHeight() { return _H; }

  // ── Clear ───────────────────────────────────────────────

  function clear() {
    _ctx.clearRect(0, 0, _W, _H);
    _ctx.fillStyle = '#07080f';
    _ctx.fillRect(0, 0, _W, _H);
  }

  // ── Starfield background ─────────────────────────────────

  function drawBackground(scrollX = 0) {
    const stars = Assets.get('bg_stars');
    const moon  = Assets.get('bg_moon');

    if (stars) {
      // Layer 1: slow parallax
      const off1 = ((-scrollX * 0.05) % _W + _W) % _W;
      _ctx.globalAlpha = 0.7;
      _ctx.drawImage(stars, off1 - _W, 0, _W, _H);
      _ctx.drawImage(stars, off1,      0, _W, _H);

      // Layer 2: faster
      _ctx.globalAlpha = 0.5;
      const off2 = ((-scrollX * 0.15) % _W + _W) % _W;
      _ctx.drawImage(stars, off2 - _W, 0, _W, _H);
      _ctx.drawImage(stars, off2,      0, _W, _H);
      _ctx.globalAlpha = 1;
    } else {
      _ctx.fillStyle = '#07080f';
      _ctx.fillRect(0, 0, _W, _H);
    }

    // Moon in background
    if (moon) {
      _ctx.globalAlpha = 0.18;
      _ctx.drawImage(moon, _W - 260, 30, 200, 200);
      _ctx.globalAlpha = 1;
    }
  }

  // ── HUD ─────────────────────────────────────────────────

  function drawHUD(state) {
    if (!state.playerShip) return;
    const ship   = state.playerShip;
    const run    = Save.getRun();
    if (!run) return;

    const ctx    = _ctx;

    // ── Left panel — ship status ─────────────────────────

    const PX = 10, PY = 10;
    _drawPanel(ctx, PX, PY, 220, 200);

    // Ship name
    ctx.fillStyle = '#e8f4ff';
    ctx.font      = '9px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(ship.label, PX + 10, PY + 20);

    // Hull
    _drawLabelBar(ctx, PX + 10, PY + 34, 200, 'HULL',
      ship.hull, ship.hullMax, '#ff2d44', '#4db8ff');

    // Shields
    _drawShieldBars(ctx, PX + 10, PY + 58, ship.shieldBars, ship.shieldMax);

    // Crew
    ctx.fillStyle = '#4a6080';
    ctx.font      = '7px Share Tech Mono, monospace';
    ctx.fillText(`CREW  ${ship.crew.length}`, PX + 10, PY + 82);

    // O2
    const o2 = ship.oxygen.averageO2();
    _drawLabelBar(ctx, PX + 10, PY + 92, 200, 'O₂',
      o2 * 100, 100, '#4db8ff', '#1a8cff');

    // Fuel & missiles
    ctx.fillStyle = '#c8d8f0';
    ctx.font      = '7px Share Tech Mono, monospace';
    ctx.fillText(`FUEL  ${run.fuel}`, PX + 10, PY + 118);
    ctx.fillText(`MISSILES  ${run.missiles}`, PX + 10, PY + 130);

    // Scrap
    ctx.fillStyle = '#ffd700';
    ctx.font      = '9px Share Tech Mono, monospace';
    ctx.fillText(`⬡ ${run.scrap}`, PX + 10, PY + 148);

    // Sector
    ctx.fillStyle = '#4a6080';
    ctx.font      = '7px Share Tech Mono, monospace';
    ctx.fillText(`SECTOR ${run.sector}`, PX + 10, PY + 164);

    // ── Right panel — weapon bars ────────────────────────

    const WX = _W - 170, WY = 10;
    _drawPanel(ctx, WX, WY, 160, 20 + ship.weapons.filter(Boolean).length * 28 + 12);

    ctx.fillStyle = '#4a6080';
    ctx.font      = '7px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('WEAPONS', WX + 10, WY + 14);

    ship.weapons.forEach((w, i) => {
      if (!w) return;
      const wx = WX + 10, wy = WY + 22 + i * 28;

      // Name
      ctx.fillStyle = w.powered ? '#c8d8f0' : '#3a4a60';
      ctx.font      = '7px Share Tech Mono, monospace';
      ctx.fillText(w.label, wx, wy + 10);

      // Charge bar
      const bw = 140, bh = 8;
      ctx.fillStyle = '#0a1828';
      ctx.fillRect(wx, wy + 14, bw, bh);

      ctx.fillStyle = w.armed   ? '#1aff8c'
                    : w.powered ? '#1a8cff'
                    : '#1a2a3a';
      ctx.fillRect(wx, wy + 14, bw * w.charge, bh);

      ctx.strokeStyle = '#1e2d4a';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(wx, wy + 14, bw, bh);
    });

    // ── Power display ────────────────────────────────────

    const reactX = PX, reactY = PY + 215;
    _drawPanel(ctx, reactX, reactY, 220, 130);
    ctx.fillStyle = '#4a6080';
    ctx.font      = '7px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('POWER', reactX + 10, reactY + 14);
    ctx.fillText(`${ship.availablePower()} free / ${ship.reactor.totalPower} total`, reactX + 10, reactY + 24);

    const systems = ship.systems.filter(s => s.maxPower > 0);
    systems.forEach((sys, i) => {
      const sy = reactY + 36 + i * 18;
      ctx.fillStyle = sys.isDisabled() ? '#4a1a1a' : '#1a2a3a';
      ctx.font      = '7px Share Tech Mono, monospace';
      ctx.fillText(sys.label.padEnd(12), reactX + 10, sy + 10);

      // Bars
      for (let b = 0; b < sys.maxPower; b++) {
        const lit = b < sys.power && !sys.isDisabled();
        ctx.fillStyle = lit ? '#1aff8c' : '#0a1010';
        ctx.fillRect(reactX + 90 + b * 9, sy, 7, 12);
        ctx.strokeStyle = '#07080f';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(reactX + 90 + b * 9, sy, 7, 12);
      }
    });

    // ── Enemy HUD (if in combat) ─────────────────────────

    if (state.enemyShip) {
      const eShip = state.enemyShip;
      const EX    = _W / 2 - 110, EY = 10;
      _drawPanel(ctx, EX, EY, 220, 60);

      ctx.fillStyle = '#ff4444';
      ctx.font      = '9px Orbitron, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(eShip.label, EX + 10, EY + 18);

      _drawLabelBar(ctx, EX + 10, EY + 28, 200, 'HULL',
        eShip.hull, eShip.hullMax, '#ff2d44', '#ff6060');

      _drawShieldBars(ctx, EX + 10, EY + 48, eShip.shieldBars, eShip.shieldMax);
    }
  }

  // ── Panel (dark rounded rect) ─────────────────────────

  function _drawPanel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(13,17,32,0.88)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,45,74,0.8)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  function _drawLabelBar(ctx, x, y, w, label, val, max, barColor, labelColor) {
    ctx.fillStyle = labelColor ?? '#4db8ff';
    ctx.font      = '7px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y + 10);

    const barX = x + 44, bw = w - 50, bh = 8;
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(barX, y + 2, bw, bh);
    ctx.fillStyle = barColor;
    ctx.fillRect(barX, y + 2, bw * Utils.clamp(val / max, 0, 1), bh);
    ctx.strokeStyle = '#1e2d4a';
    ctx.lineWidth   = 0.5;
    ctx.strokeRect(barX, y + 2, bw, bh);

    // Value text
    ctx.fillStyle = '#c8d8f0';
    ctx.fillText(`${Math.ceil(val)}/${max}`, barX + bw + 4, y + 10);
  }

  function _drawShieldBars(ctx, x, y, bars, max) {
    ctx.fillStyle = '#4a6080';
    ctx.font      = '7px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SHIELDS', x, y + 9);

    for (let i = 0; i < max; i++) {
      const lit = i < bars;
      ctx.fillStyle = lit ? '#4db8ff' : '#0a1828';
      ctx.beginPath();
      ctx.arc(x + 55 + i * 18, y + 5, 6, 0, Math.PI * 2);
      ctx.fill();
      if (lit) {
        ctx.strokeStyle = '#1a8cff';
        ctx.lineWidth   = 1;
        ctx.stroke();
      }
    }
  }

  // ── Main menu screen ─────────────────────────────────────

  function drawMainMenu(hoverBtn) {
    clear();
    drawBackground(Date.now() * 0.015);

    const ctx = _ctx;
    const cx  = _W / 2, cy = _H / 2;

    // Logo
    ctx.save();
    ctx.shadowBlur  = 24;
    ctx.shadowColor = '#1a8cff';
    ctx.fillStyle   = '#4db8ff';
    ctx.font        = '72px Orbitron, monospace';
    ctx.textAlign   = 'center';
    ctx.fillText('MOON WARS', cx, cy - 140);
    ctx.restore();

    // Subtitle
    ctx.fillStyle = '#4a6080';
    ctx.font      = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A TACTICAL SPACE SURVIVAL GAME', cx, cy - 108);

    // Buttons
    const buttons = [
      { id: 'new_game',  label: 'NEW GAME' },
      { id: 'continue',  label: 'CONTINUE' },
      { id: 'graveyard', label: 'GRAVEYARD' },
      { id: 'settings',  label: 'SETTINGS' },
    ];

    buttons.forEach((b, i) => {
      const bx = cx - 100, by = cy - 40 + i * 50, bw = 200, bh = 36;
      const hover = hoverBtn === b.id;

      ctx.fillStyle = hover ? 'rgba(26,140,255,0.25)' : 'rgba(13,17,32,0.85)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();

      ctx.strokeStyle = hover ? '#4db8ff' : '#1e2d4a';
      ctx.lineWidth   = hover ? 1.5 : 1;
      ctx.stroke();

      ctx.fillStyle = hover ? '#4db8ff' : '#c8d8f0';
      ctx.font      = '12px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, cx, by + 24);

      // Click regions registered by game.js _registerMenuButtons()
    });

    // Version
    ctx.fillStyle = '#1a2a3a';
    ctx.font      = '7px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('v0.1.0 — MOON WARS', _W - 10, _H - 10);
  }

  const _menuCallbacks = {};
  function onMenuButton(id, cb) { _menuCallbacks[id] = cb; }

  // ── Map screen ───────────────────────────────────────────

  function drawMapScreen(sectorMap, hoverNodeId = null) {
    clear();
    drawBackground(0);

    const ctx = _ctx;
    const ox  = (_W - 700) / 2;
    const oy  = (_H - 400) / 2;

    // Background panel
    _drawPanel(ctx, ox - 20, oy - 40, 740, 480);

    // Title
    ctx.fillStyle = '#c8d8f0';
    ctx.font      = '10px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SECTOR ${sectorMap.sector} MAP`, ox - 10, oy - 18);

    const run = Save.getRun();
    if (run) {
      ctx.fillStyle = '#ffd700';
      ctx.font      = '9px Share Tech Mono, monospace';
      ctx.fillText(`⬡ ${run.scrap}   FUEL ${run.fuel}`, ox + 450, oy - 18);
    }

    sectorMap.draw(ctx, ox, oy);

    // Hover tooltip
    if (hoverNodeId) {
      const node = sectorMap.getNode(hoverNodeId);
      if (node && !node.locked) {
        const tx = node.x + ox + 24, ty = node.y + oy - 24;
        _drawPanel(ctx, tx, ty, 120, 48);
        ctx.fillStyle = node.color;
        ctx.font      = '8px Orbitron, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(node.label, tx + 8, ty + 16);
        ctx.fillStyle = '#4a6080';
        ctx.font      = '7px Share Tech Mono, monospace';
        ctx.fillText('Click to travel', tx + 8, ty + 32);
      }
    }
  }

  // ── Combat screen layout ─────────────────────────────────

  function drawCombatLayout(playerShip, enemyShip) {
    // Both ships are drawn by their own draw() method;
    // this just handles the "combat arena" background line

    const ctx = _ctx;
    ctx.strokeStyle = 'rgba(30,45,70,0.3)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(_W / 2, 20);
    ctx.lineTo(_W / 2, _H - 20);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Retreat progress ─────────────────────────────────────

  function drawRetreatBar(progress) {
    const w  = 200, h = 20;
    const x  = _W / 2 - w / 2, y = _H - 50;
    _drawPanel(_ctx, x - 4, y - 4, w + 8, h + 8);
    _ctx.fillStyle = '#ff7c20';
    _ctx.fillRect(x, y, w * progress, h);
    _ctx.fillStyle = '#c8d8f0';
    _ctx.font      = '8px Share Tech Mono, monospace';
    _ctx.textAlign = 'center';
    _ctx.fillText('RETREATING…', _W / 2, y + 14);
  }

  // ── Event popup ──────────────────────────────────────────

  function drawEventPopup(event, hoverChoice = -1) {
    const ctx = _ctx;
    const W   = 480, H = 240;
    const x   = _W/2 - W/2, y = _H/2 - H/2;

    _drawPanel(ctx, x, y, W, H);

    ctx.fillStyle = '#4db8ff';
    ctx.font      = '11px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(event.title, x + 20, y + 30);

    ctx.fillStyle = '#c8d8f0';
    ctx.font      = '8px Share Tech Mono, monospace';
    // Word-wrap text (simple)
    const words  = event.text.split(' ');
    let line     = '', cy2 = y + 55;
    words.forEach(w => {
      const test = line + w + ' ';
      if (ctx.measureText(test).width > W - 40) {
        ctx.fillText(line, x + 20, cy2); cy2 += 14; line = w + ' ';
      } else { line = test; }
    });
    if (line) { ctx.fillText(line, x + 20, cy2); }

    // Choices
    event.choices.forEach((c, i) => {
      const bx = x + 20, by = y + 150 + i * 36, bw = W - 40, bh = 28;
      const hover = hoverChoice === i;

      ctx.fillStyle = hover ? 'rgba(26,140,255,0.3)' : 'rgba(20,30,50,0.8)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();
      ctx.strokeStyle = hover ? '#4db8ff' : '#1e2d4a';
      ctx.lineWidth   = 1;
      ctx.stroke();

      ctx.fillStyle = hover ? '#4db8ff' : '#c8d8f0';
      ctx.font      = '8px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(c.label, bx + 10, by + 18);

      // Click regions registered by game.js _registerEventChoices()
    });
  }

  const _eventCallbacks = {};
  function onEventChoice(idx, cb) { _eventCallbacks[idx] = cb; }

  // ── Victory / defeat splash ───────────────────────────────

  function drawOutcome(type, scrap = 0) {
    const ctx = _ctx;
    const cx  = _W / 2;

    ctx.fillStyle = 'rgba(7,8,15,0.75)';
    ctx.fillRect(0, 0, _W, _H);

    const isVictory = type === 'victory';
    ctx.fillStyle = isVictory ? '#1aff8c' : '#ff2d44';
    ctx.font      = '48px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isVictory ? 'VICTORY' : 'SHIP DESTROYED', cx, _H/2 - 40);

    if (isVictory && scrap > 0) {
      ctx.fillStyle = '#ffd700';
      ctx.font      = '16px Share Tech Mono, monospace';
      ctx.fillText(`+⬡${scrap} SCRAP COLLECTED`, cx, _H/2 + 10);
    }

    ctx.fillStyle = '#4a6080';
    ctx.font      = '10px Share Tech Mono, monospace';
    ctx.fillText('Press [SPACE] to continue', cx, _H/2 + 50);
  }

  // ── Public API ───────────────────────────────────────────

  return {
    init, getCtx, getWidth, getHeight,
    clear,
    drawBackground,
    drawHUD,
    drawMainMenu,
    drawMapScreen,
    drawCombatLayout,
    drawRetreatBar,
    drawEventPopup,
    drawOutcome,
    onMenuButton,
    onEventChoice,
  };

})();
