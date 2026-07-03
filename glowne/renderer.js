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

  const _powerClickZones = [];
  function getPowerClickZones() { return _powerClickZones; }

  /** Tiny status icon: 'crew' | 'fire' | 'noO2' — drawn at (x,y), ~12px */
  function _statusIcon(ctx, x, y, type) {
    ctx.save();
    if (type === 'crew') {
      // Little person: head + body
      ctx.fillStyle = '#4db8ff';
      ctx.beginPath(); ctx.arc(x, y - 3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 3, y, 6, 6);
    } else if (type === 'fire') {
      // Orange flame triangle with yellow core
      ctx.fillStyle = '#ff7c20';
      ctx.beginPath();
      ctx.moveTo(x, y - 6); ctx.lineTo(x - 5, y + 5); ctx.lineTo(x + 5, y + 5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(x, y - 1); ctx.lineTo(x - 2, y + 4); ctx.lineTo(x + 2, y + 4);
      ctx.closePath(); ctx.fill();
    } else if (type === 'noO2') {
      // Blue circle with slash
      ctx.strokeStyle = '#4db8ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#4db8ff';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('O', x, y + 3);
      ctx.strokeStyle = '#ff2d44';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Status icons for a system's room: crew present, fire, low O2 */
  function _roomStatus(ship, sys) {
    const out = [];
    if (!sys.roomId) return out;
    if (ship.crew.some(c => !c.dead && c.roomId === sys.roomId)) out.push('crew');
    if (ship.fires.hasFireInRoom(sys.roomId)) out.push('fire');
    const ro = ship.oxygen.getRoom(sys.roomId);
    if (ro && ro.isWarning) out.push('noO2');
    return out;
  }

  function drawHUD(state) {
    _powerClickZones.length = 0;
    if (!state.playerShip) return;
    const ship = state.playerShip;
    const run  = Save.getRun();
    if (!run) return;
    const ctx  = _ctx;

    // ════ TOP-LEFT: Player hull bar (segmented, FTL style) ════
    _drawHeartBar(ctx, 14, 14, ship.hull, ship.hullMax, '#1aff8c', '#0a3018');

    // Shield bubbles below hull
    const shieldY = 58;
    ctx.save();
    for (let i = 0; i < ship.shieldMax; i++) {
      const lit = i < ship.shieldBars;
      const bx  = 58 + i * 34;
      ctx.beginPath();
      ctx.arc(bx, shieldY + 12, 13, 0, Math.PI * 2);
      if (lit) {
        const g = ctx.createRadialGradient(bx-4, shieldY+8, 1, bx, shieldY+12, 13);
        g.addColorStop(0, '#bfe8ff');
        g.addColorStop(0.5, '#4db8ff');
        g.addColorStop(1, '#1a5a99');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = 'rgba(20,40,70,0.5)';
      }
      ctx.fill();
      ctx.strokeStyle = lit ? '#8fd4ff' : '#1e3550';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    // Evasion badge left of shields
    ctx.fillStyle = '#0d1120';
    ctx.beginPath(); ctx.arc(30, shieldY + 12, 15, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#4a6080'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#c8d8f0';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(ship.evasion * 100) + '%', 30, shieldY + 16);
    ctx.fillStyle = '#7a90a8';
    ctx.font = '8px Share Tech Mono, monospace';
    ctx.fillText('EVADE', 30, shieldY + 34);

    // O2 readout next to shield bubbles
    const o2avg = ship.oxygen.averageO2();
    const o2x   = 58 + Math.max(ship.shieldMax, 1) * 34 + 16;
    ctx.fillStyle = o2avg < 0.25 ? '#ff2d44' : o2avg < 0.6 ? '#ffd700' : '#4db8ff';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`O₂ ${Math.round(o2avg * 100)}%`, o2x, shieldY + 16);

    // ════ LEFT: Crew portraits with HP bars ════
    let crewY = 108;
    ship.crew.forEach((c, i) => {
      const cx = 14, cw = 120, ch = 26;
      const sel = UI.getSelectedCrew && UI.getSelectedCrew() === c;

      ctx.fillStyle = sel ? 'rgba(26,140,255,0.25)' : 'rgba(13,17,32,0.85)';
      ctx.beginPath(); ctx.roundRect(cx, crewY, cw, ch, 3); ctx.fill();
      ctx.strokeStyle = sel ? '#4db8ff' : '#1e2d4a';
      ctx.lineWidth = sel ? 1.5 : 1;
      ctx.stroke();

      // Mini portrait square
      ctx.fillStyle = c.isPlayer ? '#4db8ff' : '#ff4444';
      ctx.fillRect(cx + 3, crewY + 3, 20, 20);
      ctx.fillStyle = '#c8d8f0';
      ctx.fillRect(cx + 6, crewY + 5, 14, 8); // helmet

      // Name
      ctx.fillStyle = '#c8d8f0';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(c.name.slice(0, 8), cx + 28, crewY + 12);

      // HP bar
      ctx.fillStyle = '#0a1010';
      ctx.fillRect(cx + 28, crewY + 16, cw - 34, 6);
      ctx.fillStyle = c.hp / c.maxHp > 0.5 ? '#1aff8c' : c.hp / c.maxHp > 0.25 ? '#ffd700' : '#ff2d44';
      ctx.fillRect(cx + 28, crewY + 16, (cw - 34) * (c.hp / c.maxHp), 6);

      // Star
      const star = c.getStarRating();
      if (star !== 'none') {
        ctx.fillStyle = star === 'gold' ? '#ffd700' : '#aaaaaa';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('★', cx + cw - 3, crewY + 12);
      }

      // Click zone — select crew member
      _powerClickZones.push({ x: cx, y: crewY, w: cw, h: ch, crewIndex: i });

      crewY += ch + 4;
    });

    // ════ LEFT SIDE: Vertical reactor column ════
    const totalPower = ship.reactor.totalPower;
    const usedPower  = totalPower - ship.availablePower();
    const rx = 20, rBarH = 14, rGap = 3;
    const rBottom = _H - 150;
    for (let i = 0; i < totalPower; i++) {
      const by  = rBottom - i * (rBarH + rGap);
      const lit = i < (totalPower - usedPower);   // free power lights up from bottom
      ctx.fillStyle = lit ? '#ffb020' : 'rgba(40,44,60,0.8)';
      ctx.fillRect(rx, by, 30, rBarH);
      ctx.strokeStyle = '#07080f';
      ctx.lineWidth = 1;
      ctx.strokeRect(rx, by, 30, rBarH);
    }

    // ════ BOTTOM BAR: power management (FTL style) ════
    _drawPowerBar(ctx, ship, run);

    // ════ TOP-RIGHT: Enemy hull (if combat) ════
    if (state.enemyShip) {
      const e = state.enemyShip;
      _drawHeartBar(ctx, _W - 320, 14, e.hull, e.hullMax, '#ff7c20', '#301505');

      // Enemy shields + evade + O2 on one row
      for (let i = 0; i < e.shieldMax; i++) {
        const lit = i < e.shieldBars;
        const bx  = _W - 300 + i * 26;
        ctx.beginPath();
        ctx.arc(bx, 62, 9, 0, Math.PI * 2);
        ctx.fillStyle = lit ? '#4db8ff' : 'rgba(20,40,70,0.5)';
        ctx.fill();
        ctx.strokeStyle = lit ? '#8fd4ff' : '#1e3550';
        ctx.stroke();
      }
      ctx.font = '11px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#c8d8f0';
      ctx.fillText(`EV ${Math.round(e.evasion * 100)}%`, _W - 210, 66);
      const eo2 = e.oxygen.averageO2();
      ctx.fillStyle = eo2 < 0.25 ? '#ff2d44' : '#4db8ff';
      ctx.fillText(`O₂ ${Math.round(eo2 * 100)}%`, _W - 130, 66);

      // ── Enemy module panel: mini icons + power pips + status icons ──
      _drawEnemyModules(ctx, e, _W - 320, 80);
    }

    // ════ Resources row (scrap/fuel/missiles/sector) top-center ════
    const resX = 470;
    ctx.fillStyle = 'rgba(13,17,32,0.85)';
    ctx.beginPath(); ctx.roundRect(resX, 10, 320, 26, 4); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`⬡${run.scrap}`, resX + 12, 28);
    ctx.fillStyle = '#1aff8c';
    ctx.fillText(`FUEL ${run.fuel}`, resX + 82, 28);
    ctx.fillStyle = '#ff7c20';
    ctx.fillText(`MSL ${run.missiles}`, resX + 172, 28);
    ctx.fillStyle = '#4db8ff';
    ctx.fillText(`SEC ${run.sector}`, resX + 256, 28);
  }

  /** FTL-style segmented health bar with heart icon */
  function _drawHeartBar(ctx, x, y, val, max, color, dimColor) {
    // Heart circle
    ctx.fillStyle = '#0d1120';
    ctx.beginPath(); ctx.arc(x + 16, y + 16, 17, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('♥', x + 16, y + 22);

    // Segments — width adapts so the bar never exceeds ~360px
    const gap  = 2;
    const segW = Math.max(7, Math.min(15, Math.floor(360 / max) - gap));
    const segH = 18;
    const startX = x + 40;
    for (let i = 0; i < max; i++) {
      const sx  = startX + i * (segW + gap);
      const lit = i < val;
      ctx.fillStyle = lit ? color : dimColor;
      ctx.beginPath();
      ctx.roundRect(sx, y + 7, segW, segH, 2);
      ctx.fill();
      if (lit && segW > 9) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(sx + 2, y + 9, segW - 4, 3);
      }
    }
  }

  /**
   * FTL-style bottom power bar.
   * Icons in circles, clickable power pips above each icon,
   * weapons with charge segments, all connected by power line.
   * Click zones stored in _powerClickZones for game.js to consume.
   */

  /** Compact FTL-style enemy systems readout: icon + mini pips + status */
  function _drawEnemyModules(ctx, ship, x, y) {
    const systems = ship.systems.filter(s => s.maxPower > 0);
    const glyphs = {
      shields: '◙', weapons: '▲', engines: '≋',
      oxygen: 'O₂', medbay: '+', piloting: '◎', artillery: '✦',
    };

    let ix = x + 14;
    systems.forEach(sys => {
      // Status icons (crew / fire / no-O2) ABOVE the pip stack
      const status = _roomStatus(ship, sys);
      status.forEach((st, si) => {
        _statusIcon(ctx, ix, y - 8 - si * 14, st);
      });

      // Mini power pips (vertical, small)
      const pw = 12, ph = 5, pg = 2;
      for (let p = 0; p < sys.maxPower; p++) {
        const py      = y + 30 - p * (ph + pg);
        const damaged = p >= sys.maxPower - sys.damagedLevels;
        const lit     = !damaged && p < sys.power;
        ctx.fillStyle = damaged ? '#cc2233'
                      : lit     ? '#ff9040'
                      : 'rgba(50,40,40,0.85)';
        ctx.fillRect(ix - pw/2, py, pw, ph);
        ctx.strokeStyle = damaged ? '#ff5566' : '#07080f';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(ix - pw/2, py, pw, ph);
      }

      // Icon below pips
      const disabled = sys.isDisabled();
      ctx.fillStyle = '#0d1120';
      ctx.beginPath(); ctx.arc(ix, y + 48, 11, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = disabled ? '#663333' : '#aa5522';
      ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = disabled ? '#884444' : '#ffb080';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(glyphs[sys.type] ?? '?', ix, y + 51);

      ix += 34;
    });
  }

  function _drawPowerBar(ctx, ship, run) {

    const barY   = _H - 96;
    const iconR  = 20;
    let   ix     = 90;
    const systems = ship.systems.filter(s => s.maxPower > 0);

    // Power line along the bottom
    ctx.strokeStyle = '#ff7c20';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(36, _H - 130);
    ctx.lineTo(36, _H - 30);
    ctx.lineTo(_W - 60, _H - 30);
    ctx.stroke();

    const iconGlyphs = {
      shields: '◙', weapons: '▲', engines: '≋',
      oxygen: 'O₂', medbay: '+', piloting: '◎', artillery: '✦',
    };

    systems.forEach(sys => {
      const cy = _H - 52;

      // Vertical line from power rail to icon
      ctx.strokeStyle = '#ff7c20';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ix, _H - 30);
      ctx.lineTo(ix, cy + iconR);
      ctx.stroke();

      // Icon circle
      const disabled = sys.isDisabled();
      ctx.fillStyle = '#0d1120';
      ctx.beginPath(); ctx.arc(ix, cy, iconR, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = disabled ? '#663333' : (sys.power > 0 ? '#ffb020' : '#4a6080');
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = disabled ? '#884444' : (sys.power > 0 ? '#ffd780' : '#7a90a8');
      ctx.font = '15px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(iconGlyphs[sys.type] ?? '?', ix, cy + 5);

      // Power pips ABOVE icon (click to add/remove)
      // Damaged levels render as RED squares at the top of the stack.
      const pipW = 22, pipH = 9, pipGap = 3;
      for (let p = 0; p < sys.maxPower; p++) {
        const py       = cy - iconR - 12 - p * (pipH + pipGap);
        const damaged  = p >= sys.maxPower - sys.damagedLevels;   // top slots break first
        const lit      = !damaged && p < sys.power;
        const ion      = sys.ionDamage > 0 && lit;

        ctx.fillStyle = damaged ? '#cc2233'
                      : ion     ? '#4db8ff'
                      : lit     ? '#ffb020'
                      : 'rgba(40,44,60,0.9)';
        ctx.fillRect(ix - pipW/2, py, pipW, pipH);
        ctx.strokeStyle = damaged ? '#ff5566' : '#07080f';
        ctx.lineWidth = 1;
        ctx.strokeRect(ix - pipW/2, py, pipW, pipH);

        if (!damaged) {
          _powerClickZones.push({
            x: ix - pipW/2 - 2, y: py - 2, w: pipW + 4, h: pipH + 4,
            system: sys.type, pip: p,
          });
        }
      }

      // System label below icon
      ctx.fillStyle = '#7a90a8';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(sys.label, ix, cy + iconR + 12);

      // Status icons ABOVE the pip stack (crew manning / fire / no O2)
      {
        const stackTop = cy - iconR - 12 - sys.maxPower * (pipH + pipGap);
        const status = _roomStatus(ship, sys);
        status.forEach((st, si) => {
          _statusIcon(ctx, ix, stackTop - 8 - si * 15, st);
        });
      }

      // Icon click = toggle whole module on/off (power returns to reactor)
      _powerClickZones.push({
        x: ix - iconR, y: cy - iconR, w: iconR * 2, h: iconR * 2,
        systemToggle: sys.type,
      });

      ix += 62;
    });

    // ── Weapons section (right of systems) ──
    ix += 20;
    ship.weapons.forEach((w, i) => {
      if (!w) return;
      const wy = _H - 74;
      const ww = 130, wh = 42;

      // Weapon card
      const armed = w.armed;
      ctx.fillStyle = armed ? 'rgba(26,255,140,0.12)' : 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(ix, wy, ww, wh, 4); ctx.fill();
      ctx.strokeStyle = armed ? '#1aff8c' : (w.powered ? '#ffb020' : '#3a4455');
      ctx.lineWidth = armed ? 2 : 1;
      ctx.stroke();

      // Number + name
      ctx.fillStyle = armed ? '#1aff8c' : '#c8d8f0';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${i+1}· ${w.label.slice(0,14)}`, ix + 6, wy + 14);

      // Charge segments
      const segs = 4;
      const segW2 = (ww - 16) / segs - 3;
      for (let s = 0; s < segs; s++) {
        const filled = w.charge * segs > s;
        const full   = w.charge * segs >= s + 1;
        ctx.fillStyle = full ? (armed ? '#1aff8c' : '#4db8ff')
                      : filled ? 'rgba(77,184,255,0.4)'
                      : 'rgba(30,36,50,0.9)';
        ctx.fillRect(ix + 8 + s * (segW2 + 3), wy + 22, segW2, 12);
      }

      // Click zone to select/fire
      _powerClickZones.push({
        x: ix, y: wy, w: ww, h: wh,
        weapon: i,
      });

      // AUTO toggle button under the card
      const abW = 52, abH = 16;
      const abX = ix + ww/2 - abW/2, abY = wy + wh + 4;
      ctx.fillStyle = w.autoFire ? 'rgba(26,255,140,0.25)' : 'rgba(13,17,32,0.9)';
      ctx.beginPath(); ctx.roundRect(abX, abY, abW, abH, 3); ctx.fill();
      ctx.strokeStyle = w.autoFire ? '#1aff8c' : '#3a4455';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = w.autoFire ? '#1aff8c' : '#7a90a8';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(w.autoFire ? 'AUTO ON' : 'AUTO OFF', abX + abW/2, abY + 12);

      _powerClickZones.push({
        x: abX, y: abY, w: abW, h: abH,
        weaponAuto: i,
      });

      ix += ww + 12;
    });
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
    ctx.font      = '11px Share Tech Mono, monospace';
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
    ctx.font      = '11px Share Tech Mono, monospace';
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
      ctx.font      = '14px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, cx, by + 24);

      // Click regions registered by game.js _registerMenuButtons()
    });

    // Version
    ctx.fillStyle = '#1a2a3a';
    ctx.font      = '11px Share Tech Mono, monospace';
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
    ctx.font      = '14px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SECTOR ${sectorMap.sector} MAP`, ox - 10, oy - 18);

    const run = Save.getRun();
    if (run) {
      ctx.fillStyle = '#ffd700';
      ctx.font      = '13px Share Tech Mono, monospace';
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
        ctx.font      = '14px Orbitron, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(node.label, tx + 8, ty + 16);
        ctx.fillStyle = '#4a6080';
        ctx.font      = '11px Share Tech Mono, monospace';
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
    _ctx.font      = '12px Share Tech Mono, monospace';
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
    ctx.font      = '15px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(event.title, x + 20, y + 30);

    ctx.fillStyle = '#c8d8f0';
    ctx.font      = '12px Share Tech Mono, monospace';
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
      ctx.font      = '12px Share Tech Mono, monospace';
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
    ctx.font      = '12px Share Tech Mono, monospace';
    ctx.fillText('Press [SPACE] to continue', cx, _H/2 + 50);
  }

  // ── Public API ───────────────────────────────────────────

  return {
    init, getCtx, getWidth, getHeight,
    clear,
    drawBackground,
    drawHUD,
    getPowerClickZones,
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
