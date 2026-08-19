/* ============================================================
   MOON WARS — ui.js
   Canvas-rendered UI system.
   Handles: notification stack, tooltips, crew selection,
   power allocation clicks, station DOM screen, graveyard.
   ============================================================ */

'use strict';

const UI = (() => {

  // ── Notification stack ────────────────────────────────────

  const _notifs = [];
  const NOTIF_DURATION = 3.5;

  function notify(message, type = 'info') {
    // type: info | warn | alert | good
    _notifs.push({ message, type, life: NOTIF_DURATION });
  }

  function _updateNotifs(dt) {
    for (let i = _notifs.length - 1; i >= 0; i--) {
      _notifs[i].life -= dt;
      if (_notifs[i].life <= 0) _notifs.splice(i, 1);
    }
  }

  function _drawNotifs(ctx, W) {
    // Bottom-center, stacking UPWARD above the power bar — the old
    // top-right spot covered the enemy hull/EV/O₂ readout.
    const W_BOX = 300, H_BOX = 28, GAP = 4;
    const H = (typeof Renderer !== 'undefined') ? Renderer.getHeight() : 720;
    let stackY = H - 140 - H_BOX;

    _notifs.forEach((n, i) => {
      const alpha = Utils.clamp(n.life / NOTIF_DURATION, 0, 1);
      const x     = (W - W_BOX) / 2;
      const y     = stackY;

      ctx.globalAlpha = alpha;

      ctx.fillStyle = 'rgba(13,17,32,0.92)';
      ctx.beginPath(); ctx.roundRect(x, y, W_BOX, H_BOX, 4); ctx.fill();

      const borderColor = {
        info:  '#1a8cff', warn: '#ff7c20',
        alert: '#ff2d44', good: '#1aff8c',
      }[n.type] ?? '#1a8cff';

      ctx.fillStyle = borderColor;
      ctx.fillRect(x, y, 3, H_BOX);

      ctx.fillStyle = '#c8d8f0';
      ctx.font      = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(n.message, x + 10, y + 18);

      ctx.globalAlpha = 1;
      stackY -= H_BOX + GAP;   // grow upward
    });
  }

  // ── Tooltip ───────────────────────────────────────────────

  let _tooltip = null;

  function showTooltip(title, lines, mx, my) {
    _tooltip = { title, lines, x: mx, y: my };
  }

  function hideTooltip() { _tooltip = null; }

  function _drawTooltip(ctx, W, H) {
    if (!_tooltip) return;
    const { title, lines, x, y } = _tooltip;
    const TW = 180, lineH = 14;
    const TH = 24 + lines.length * lineH;

    let tx = x + 14;
    let ty = y - 8;
    if (tx + TW > W) tx = x - TW - 6;
    if (ty + TH > H) ty = H - TH - 6;

    ctx.fillStyle = 'rgba(13,17,32,0.96)';
    ctx.beginPath(); ctx.roundRect(tx, ty, TW, TH, 6); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#4db8ff';
    ctx.font      = '14px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(title, tx + 8, ty + 16);

    lines.forEach((l, i) => {
      ctx.fillStyle = '#c8d8f0';
      ctx.font      = '11px Share Tech Mono, monospace';
      ctx.fillText(l, tx + 8, ty + 28 + i * lineH);
    });
  }

  // ── Crew panel ────────────────────────────────────────────

  // Station blueprint-shop selection state
  let _shopPick    = null;   // {kind:'new'|'wpn', idx?} — new module chosen
  let _shopRoomSel = null;   // room id clicked on the blueprint

  // Multi-selection (FTL / Windows style): an ARRAY of crew members.
  let _selected = [];

  function selectCrew(member, additive = false) {
    if (!member) return;
    if (additive) {
      const i = _selected.indexOf(member);
      if (i === -1) _selected.push(member);
      else _selected.splice(i, 1);          // shift-click toggles
    } else {
      _selected = [member];
    }
    Audio.sfx.uiClick();
  }

  /** Replace the selection with a whole group (rubber-band select) */
  function selectCrewGroup(list, additive = false) {
    if (additive) {
      list.forEach(m => { if (!_selected.includes(m)) _selected.push(m); });
    } else {
      _selected = [...list];
    }
    if (list.length) Audio.sfx.uiClick();
  }

  function deselectCrew() { _selected = []; }

  function _pruneSelection() {
    _selected = _selected.filter(c => c && !c.dead && !c.dying);
  }

  /** First selected member (legacy single-crew callers) */
  function getSelectedCrew() { _pruneSelection(); return _selected[0] ?? null; }

  /** Everyone currently selected */
  function getSelectedCrewAll() { _pruneSelection(); return [..._selected]; }

  /** Crew member under the mouse: ship sprite first, then list rows */
  function _hoveredCrew(ship) {
    if (!ship || typeof Input === 'undefined') return null;
    const mx = Input.mouse.x, my = Input.mouse.y;
    // ONLY the roster rows on the left open the skill panel. Hovering a
    // crew member ON THE SHIP used to open it too, which meant the panel
    // popped up over the ship exactly when you were trying to fight.
    if (typeof Renderer !== 'undefined') {
      const z = Renderer.getPowerClickZones().find(z =>
        z.crewIndex !== undefined &&
        Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h));
      if (z) return ship.crew[z.crewIndex] ?? null;
    }
    return null;
  }

  function drawCrewPanel(ctx, ship, W, H) {
    if (!ship) return;
    const crew = ship.crew;
    if (!crew.length) return;

    const PAD = 10;
    const PW  = 180;
    const PX  = W - PW - PAD;
    const PY  = H - 200;

    ctx.fillStyle = 'rgba(13,17,32,0.88)';
    ctx.beginPath(); ctx.roundRect(PX, PY, PW, 190, 6); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#4a6080';
    ctx.font      = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CREW', PX + 8, PY + 14);

    crew.forEach((c, i) => {
      const cy  = PY + 22 + i * 30;
      const sel = _selected.includes(c);

      // Row bg
      ctx.fillStyle = sel ? 'rgba(26,140,255,0.2)' : 'rgba(20,30,50,0.4)';
      ctx.fillRect(PX + 4, cy, PW - 8, 26);
      if (sel) {
        ctx.strokeStyle = '#4db8ff';
        ctx.lineWidth   = 1;
        ctx.strokeRect(PX + 4, cy, PW - 8, 26);
      }

      // Name
      ctx.fillStyle = sel ? '#4db8ff' : '#c8d8f0';
      ctx.font      = '12px Share Tech Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(c.name, PX + 8, cy + 12);

      // Task indicator
      const taskColor = {
        [TASK.IDLE]:    '#4a6080',
        [TASK.REPAIR]:  '#1aff8c',
        [TASK.FIRE]:    '#ff7c20',
        [TASK.FIGHT]:   '#ff2d44',
        [TASK.BREACH]:  '#cc44ff',
        [TASK.OPERATE]: '#4db8ff',
      }[c.task] ?? '#4a6080';

      ctx.fillStyle = taskColor;
      ctx.font      = '12px Share Tech Mono, monospace';
      ctx.fillText(c.task.toUpperCase(), PX + 8, cy + 23);

      // HP bar
      const hpW = (PW - 24) * (c.hp / c.maxHp);
      ctx.fillStyle = '#0a1010';
      ctx.fillRect(PX + PW - 36, cy + 4, 28, 6);
      ctx.fillStyle = c.hp / c.maxHp > 0.5 ? '#1aff8c' : '#ff2d44';
      ctx.fillRect(PX + PW - 36, cy + 4, hpW * 28 / (PW - 24), 6);

      // Star rating
      const star = c.getStarRating();
      if (star !== 'none') {
        ctx.fillStyle = star === 'gold' ? '#ffd700' : '#aaaaaa';
        ctx.font      = '12px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('★', PX + PW - 8, cy + 14);
      }

      // Selection handled by checkCrewClick() called from game update
    });
  }

  // ── Skill popup (when crew selected) ─────────────────────

  function drawSkillPanel(ctx, crew, W, H) {
    if (!crew) return;

    const PW  = 200, PH = 200;
    const PX  = W - 200 - 200, PY = H - 210;

    ctx.fillStyle = 'rgba(13,17,32,0.96)';
    ctx.beginPath(); ctx.roundRect(PX, PY, PW, PH, 6); ctx.fill();
    ctx.strokeStyle = '#1a8cff'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#4db8ff';
    ctx.font      = '14px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(crew.name, PX + 8, PY + 18);

    ctx.fillStyle = '#4a6080';
    ctx.font      = '11px Share Tech Mono, monospace';
    ctx.fillText(`HP: ${Math.ceil(crew.hp)}/${crew.maxHp}`, PX + 8, PY + 30);

    let sy = PY + 44;
    Object.entries(crew.skills).forEach(([key, sk]) => {
      const def = SKILL_DEFS[key];
      if (!def) return;

      ctx.fillStyle = sk.level > 0 ? def.color : '#2a3a4a';
      ctx.font      = '11px Share Tech Mono, monospace';
      ctx.fillText(def.label.padEnd(12), PX + 8, sy + 9);

      // Level pips
      for (let l = 0; l < MAX_SKILL_LEVEL; l++) {
        ctx.fillStyle = l < sk.level ? def.color : '#1a2030';
        ctx.fillRect(PX + 110 + l * 14, sy, 10, 10);
        ctx.strokeStyle = '#07080f'; ctx.lineWidth = 0.5;
        ctx.strokeRect(PX + 110 + l * 14, sy, 10, 10);
      }

      // XP bar (if not maxed)
      if (sk.level < MAX_SKILL_LEVEL) {
        const xpMax = SKILL_DEFS[key].xpPerLevel[sk.level] ?? 100;
        ctx.fillStyle = '#0a1010';
        ctx.fillRect(PX + 8, sy + 12, PW - 16, 3);
        ctx.fillStyle = def.color;
        ctx.fillRect(PX + 8, sy + 12, (PW - 16) * (sk.xp / xpMax), 3);
      }

      sy += 22;
    });
  }

  // ── Power click handling ──────────────────────────────────

  /**
   * Handle a click on the power bar area for a system.
   * Increases/decreases power by 1 bar.
   */
  function handlePowerClick(ship, systemType, barIndex) {
    const sys = ship.getSystem(systemType);
    if (!sys) return;

    if (barIndex < sys.power) {
      // Click on lit bar — decrease
      ship.setPower(systemType, sys.power - 1);
    } else {
      // Click on unlit bar — increase
      ship.setPower(systemType, sys.power + 1);
    }
    Audio.sfx.uiClick();
  }

  // ── Station screen (DOM) ──────────────────────────────────

  let _stationEl     = null;
  let _currentStation = null;
  let _stationShip   = null;
  let _stationRun    = null;
  let _activeTab     = 'repair';

  function openStation(station, ship) {
    _currentStation = station;
    _stationShip    = ship;
    _stationRun     = Save.getRun();

    Audio.playMusic('station');

    _stationEl = document.getElementById('station-screen');
    if (!_stationEl) {
      _stationEl = _buildStationDOM();
      document.getElementById('ui-overlay').appendChild(_stationEl);
    }
    _renderStation();
    _stationEl.classList.add('visible');
  }

  function closeStation() {
    if (_stationEl) _stationEl.classList.remove('visible');
    _currentStation = null;
    Audio.playMusic('explore');
  }

  function _buildStationDOM() {
    const el  = document.createElement('div');
    el.id     = 'station-screen';
    return el;
  }

  function _renderStation() {
    if (!_stationEl || !_currentStation) return;
    const s   = _currentStation;
    const run = Save.getRun();

    // Each kind of port gets its own accent + one line telling you what
    // it is good for — otherwise every station reads identically and
    // the type badge is just decoration.
    const PORT = {
      military: { col: '#ff5566', line: 'Fleet yard — heavier guns, plating on tap.' },
      science:  { col: '#4dd8ff', line: 'Research post — modules and odd tech.' },
      general:  { col: '#1aff8c', line: 'Trade hub — a bit of everything, fair prices.' },
      outpost:  { col: '#ffb020', line: 'Frontier outpost — thin stock, cheap fuel.' },
    };
    const port = PORT[s.type] || PORT.general;

    _stationEl.style.setProperty('--port-accent', port.col);
    _stationEl.innerHTML = `
      <div class="station-header">
        <div class="station-sigil" style="--sig:${port.col}"></div>
        <div>
          <div class="station-name">${s.name}</div>
          <div class="station-sub">${port.line}</div>
        </div>
        <div class="station-type-badge" style="border-color:${port.col};color:${port.col}">
          ${s.type.toUpperCase()}</div>
        <div class="station-scrap">${run?.scrap ?? 0} CC</div>
      </div>
      <div class="station-tabs">
        ${['repair','weapons','modules','crew','cargo']
            .map(t => `<div class="station-tab${_activeTab===t?' active':''}"
                          data-tab="${t}">${t.toUpperCase()}</div>`).join('')}
      </div>
      <div class="station-content" id="station-content">
      </div>
      <button class="station-close" id="station-close-btn">DEPART</button>
    `;

    // Tab clicks
    _stationEl.querySelectorAll('.station-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _activeTab = tab.dataset.tab;
        Audio.sfx.uiClick();
        _renderStation();
      });
    });

    document.getElementById('station-close-btn').addEventListener('click', () => {
      Audio.sfx.uiClick();
      closeStation();
    });

    _renderStationTab(_activeTab);
  }

  function _renderStationTab(tab) {
    const container = document.getElementById('station-content');
    if (!container) return;
    container.innerHTML = '';

    const s   = _currentStation;
    const run = Save.getRun();

    switch (tab) {

      case 'repair': {
        // ══ DOCK SERVICES ═════════════════════════════════════
        // Left: what state the SHIP is actually in (you cannot decide
        // how much repair to buy without seeing the damage). Right:
        // the services, each with a quantity you control.
        const ship = _stationShip;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'grid-column:1/-1;display:flex;gap:14px;align-items:flex-start;padding:6px';
        container.appendChild(wrap);

        const card = (parent, accent = '#1e2d4a') => {
          const d = document.createElement('div');
          d.style.cssText = `background:rgba(20,30,50,0.7);border:1px solid ${accent};
            border-radius:5px;padding:10px 12px;margin:0 0 8px`;
          parent.appendChild(d);
          return d;
        };
        const head = (parent, txt) => {
          const d = document.createElement('div');
          d.style.cssText = 'color:#4db8ff;font:13px Orbitron,monospace;letter-spacing:1px;margin:2px 0 8px';
          d.textContent = txt;
          parent.appendChild(d);
        };
        const line = (parent, label, value, col = '#c8d8f0') => {
          const d = document.createElement('div');
          d.style.cssText = 'display:flex;justify-content:space-between;gap:10px;font-size:11px;margin:3px 0';
          d.innerHTML = `<span style="color:#7a90a8">${label}</span><span style="color:${col}">${value}</span>`;
          parent.appendChild(d);
          return d;
        };
        const meter = (parent, val, max, col) => {
          const bar = document.createElement('div');
          bar.style.cssText = 'height:7px;background:#0a1018;border:1px solid #1e2d4a;border-radius:2px;margin:2px 0 6px;overflow:hidden';
          const fill = document.createElement('div');
          const pct = max ? Math.max(0, Math.min(1, val / max)) * 100 : 0;
          fill.style.cssText = `height:100%;width:${pct}%;background:${col}`;
          bar.appendChild(fill);
          parent.appendChild(bar);
        };
        const btn = (parent, label, enabled, fn, color = '#4db8ff') => {
          const b = document.createElement('span');
          b.textContent = label;
          b.style.cssText = `display:inline-block;margin:6px 6px 0 0;padding:5px 12px;
            border:1px solid ${enabled ? color : '#333c50'};border-radius:3px;font-size:11px;
            color:${enabled ? color : '#4a6080'};cursor:${enabled ? 'pointer' : 'default'};
            user-select:none;background:${enabled ? color + '14' : 'transparent'}`;
          if (enabled) b.addEventListener('click', fn);
          parent.appendChild(b);
          return b;
        };

        // ── LEFT: ship status ────────────────────────────────
        const left = document.createElement('div');
        left.style.cssText = 'width:290px;flex:0 0 290px';
        wrap.appendChild(left);
        head(left, 'SHIP STATUS');

        const st = card(left, ship.hull < ship.hullMax * 0.5 ? '#5a2a2a' : '#1e3a5c');
        const hullCol = ship.hull < ship.hullMax * 0.34 ? '#ff2d44'
                      : ship.hull < ship.hullMax * 0.67 ? '#ffd700' : '#1aff8c';
        line(st, 'HULL', `${ship.hull} / ${ship.hullMax}`, hullCol);
        meter(st, ship.hull, ship.hullMax, hullCol);
        line(st, 'He2',      run.fuel,     run.fuel <= 2 ? '#ff2d44' : '#ff5566');
        line(st, 'MISSILES', run.missiles, '#ff7c20');
        line(st, 'CC',       run.scrap,    '#1aff8c');

        const broken = ship.systems.filter(sy => sy.damagedLevels > 0);
        line(st, 'DAMAGED MODULES', broken.length || '—',
             broken.length ? '#ffd700' : '#7a90a8');
        if (broken.length) {
          const d = document.createElement('div');
          d.style.cssText = 'color:#ffd700;font-size:10px;margin-top:2px';
          d.textContent = broken.map(sy => sy.label).join(', ') +
            ' — your crew repair these for free, in flight.';
          st.appendChild(d);
        }

        // Crew condition, so the clinic price makes sense
        const patients = ship.crew.filter(c =>
          !c.dead && (c.hp < c.maxHp || c.state === 'injured' || c.infected));
        const crewCard = card(left, patients.length ? '#5a4a1a' : '#1e2d4a');
        line(crewCard, 'CREW', `${ship.crew.filter(c => !c.dead).length} aboard`);
        ship.crew.filter(c => !c.dead).forEach(c => {
          const tag = c.state === 'injured' ? 'DOWN'
                    : c.infected ? 'SICK'
                    : c.hp < c.maxHp ? 'HURT' : 'ok';
          const col = tag === 'DOWN' ? '#ff2d44' : tag === 'SICK' ? '#3aff6a'
                    : tag === 'HURT' ? '#ffd700' : '#7a90a8';
          line(crewCard, c.name, `${Math.ceil(c.hp)}/${c.maxHp}  ${tag}`, col);
        });

        // ── RIGHT: services ──────────────────────────────────
        const right = document.createElement('div');
        right.style.cssText = 'flex:1;min-width:0';
        wrap.appendChild(right);
        head(right, `DOCK SERVICES — ${s.type.toUpperCase()} PORT`);

        // Hull repair, with a quantity you choose
        {
          const missing = ship.hullMax - ship.hull;
          const canDo   = Math.min(missing, s.stock.hullRepair,
                                   Math.floor(run.scrap / s.hullRepairCost()));
          const d = card(right, missing ? '#1e3a5c' : '#1e2d4a');
          const t = document.createElement('div');
          t.style.cssText = 'color:#e8f4ff;font-size:13px;font-weight:bold';
          t.textContent = 'HULL REPAIR';
          d.appendChild(t);
          line(d, 'damage to fix', missing ? `${missing} HP` : 'none — hull is sound',
               missing ? '#ffd700' : '#1aff8c');
          line(d, 'yard can supply', `${s.stock.hullRepair} HP`);
          line(d, 'price', `${s.hullRepairCost()} CC per HP`, '#ffd700');
          if (missing && canDo > 0) {
            [1, 5, canDo].filter((v, i, a) => v > 0 && a.indexOf(v) === i).forEach(n => {
              btn(d, n === canDo && canDo > 5 ? `ALL ${canDo} HP — ${n * s.hullRepairCost()} CC`
                                              : `+${n} HP — ${n * s.hullRepairCost()} CC`,
                  true, () => {
                    const r = s.buyHullRepair(n, ship);
                    notify(r.message, r.ok ? 'good' : 'warn');
                    _renderStation();
                  }, '#1aff8c');
            });
          } else if (!missing) {
            line(d, '', 'Nothing to repair.', '#7a90a8');
          } else {
            line(d, '', s.stock.hullRepair <= 0 ? 'This yard has no plating left.'
                                                : `You cannot afford a single HP (${s.hullRepairCost()} CC).`,
                 '#ff5566');
          }
        }

        // Clinic — the ONLY cure for the corpse plague
        {
          const cost = patients.length * 12;
          const d = card(right, patients.length ? '#5a4a1a' : '#1e2d4a');
          const t = document.createElement('div');
          t.style.cssText = 'color:#e8f4ff;font-size:13px;font-weight:bold';
          t.textContent = '⚕ MEDICAL CLINIC';
          d.appendChild(t);
          if (!patients.length) {
            line(d, '', 'Every hand is fit — nothing to treat here.', '#1aff8c');
          } else {
            line(d, 'patients', `${patients.length}`, '#ffd700');
            line(d, 'price', `12 CC each — ${cost} CC total`, '#ffd700');
            line(d, 'includes', 'full heal · wounded back on their feet · plague cured', '#7a90a8');
            btn(d, `TREAT ALL — ${cost} CC`, run.scrap >= cost, () => {
              const r = s.healCrew(ship, run);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            }, run.scrap >= cost ? '#1aff8c' : '#ff5566');
            if (run.scrap < cost) {
              line(d, '', `You have ${run.scrap} CC — ${cost - run.scrap} short.`, '#ff5566');
            }
          }
        }

        // Consumables, bought in useful amounts
        [
          { key: 'fuel', title: 'He2 FUEL', stock: s.stock.fuel, unit: s.fuelCost(),
            have: run.fuel, col: '#ff5566',
            note: 'One unit per jump. Running dry strands you.',
            buy: (n) => s.buyFuel(n, run) },
          { key: 'missiles', title: 'MISSILES', stock: s.stock.missiles, unit: s.missileCost(),
            have: run.missiles, col: '#ff7c20',
            note: 'Missile launchers bypass shields but eat these.',
            buy: (n) => s.buyMissiles(n, run) },
        ].forEach(item => {
          const d = card(right);
          const t = document.createElement('div');
          t.style.cssText = `color:${item.col};font-size:13px;font-weight:bold`;
          t.textContent = item.title;
          d.appendChild(t);
          line(d, 'you carry', item.have, item.col);
          line(d, 'in stock',  item.stock);
          line(d, 'price', `${item.unit} CC each`, '#ffd700');
          line(d, '', item.note, '#7a90a8');
          const most = Math.min(item.stock, Math.floor(run.scrap / item.unit));
          if (most <= 0) {
            line(d, '', item.stock <= 0 ? 'Sold out at this port.'
                                        : `Not enough CC (${item.unit} each).`, '#ff5566');
          } else {
            [1, 5, most].filter((v, i, a) => v > 0 && v <= most && a.indexOf(v) === i)
              .forEach(n => {
                btn(d, n === most && most > 5 ? `ALL ${most} — ${n * item.unit} CC`
                                              : `+${n} — ${n * item.unit} CC`,
                    true, () => {
                      const r = item.buy(n);
                      notify(r.message, r.ok ? 'good' : 'warn');
                      _renderStation();
                    }, '#1aff8c');
              });
          }
        });
        break;
      }

      case 'weapons': {
        // ══ WEAPONS BAY ═══════════════════════════════════════
        // Two columns: what is BOLTED TO YOUR SHIP on the left (with
        // the cargo rack under it), what the STATION SELLS on the
        // right. Every gun shows the same four numbers in the same
        // place, so two guns can actually be compared at a glance.
        const ship = _stationShip;

        const wrap = document.createElement('div');
        wrap.style.cssText = 'grid-column:1/-1;display:flex;gap:14px;align-items:flex-start;padding:6px';
        container.appendChild(wrap);

        const column = (title, hint) => {
          const col = document.createElement('div');
          col.style.cssText = 'flex:1;min-width:0';
          const h = document.createElement('div');
          h.style.cssText = 'color:#4db8ff;font:13px Orbitron,monospace;letter-spacing:1px;margin:2px 0 2px';
          h.textContent = title;
          col.appendChild(h);
          if (hint) {
            const t = document.createElement('div');
            t.style.cssText = 'color:#7a90a8;font-size:10px;margin-bottom:8px';
            t.textContent = hint;
            col.appendChild(t);
          }
          wrap.appendChild(col);
          return col;
        };

        /** The same four numbers, always in the same order. */
        const statChips = (def) => {
          const chips = [
            ['DMG',    def.damage,        '#ff5566'],
            ['CHARGE', def.chargeTime + 's', '#4db8ff'],
            ['POWER',  '⚡' + def.powerCost, '#ffb020'],
            ['SHOTS',  def.shots ?? 1,     '#1aff8c'],
          ];
          if (def.missileUse) chips.push(['AMMO', def.missileUse + ' msl', '#ff7c20']);
          const box = document.createElement('div');
          box.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 2px';
          chips.forEach(([k, v, col]) => {
            const c = document.createElement('span');
            c.style.cssText = `border:1px solid ${col}44;border-radius:3px;padding:1px 6px;
              font-size:10px;color:${col};background:${col}14;white-space:nowrap`;
            c.innerHTML = `<span style="opacity:.65">${k}</span> ${v}`;
            box.appendChild(c);
          });
          return box;
        };

        const card = (parent, accent = '#1e2d4a') => {
          const d = document.createElement('div');
          d.style.cssText = `background:rgba(20,30,50,0.7);border:1px solid ${accent};
            border-radius:5px;padding:9px 11px;margin:0 0 8px`;
          parent.appendChild(d);
          return d;
        };

        const title = (parent, txt, col = '#e8f4ff', size = 13) => {
          const d = document.createElement('div');
          d.style.cssText = `color:${col};font-size:${size}px;font-weight:bold`;
          d.textContent = txt;
          parent.appendChild(d);
          return d;
        };

        const sub = (parent, txt, col = '#7a90a8') => {
          const d = document.createElement('div');
          d.style.cssText = `color:${col};font-size:10px;margin-top:3px`;
          d.textContent = txt;
          parent.appendChild(d);
          return d;
        };

        const btn = (parent, label, enabled, fn, color = '#4db8ff') => {
          const b = document.createElement('span');
          b.textContent = label;
          b.style.cssText = `display:inline-block;margin:6px 6px 0 0;padding:5px 12px;
            border:1px solid ${enabled ? color : '#333c50'};border-radius:3px;font-size:11px;
            color:${enabled ? color : '#4a6080'};cursor:${enabled ? 'pointer' : 'default'};
            user-select:none;background:${enabled ? color + '14' : 'transparent'}`;
          if (enabled) b.addEventListener('click', fn);
          parent.appendChild(b);
          return b;
        };

        // ── LEFT: the ship ────────────────────────────────────
        const left = column(`YOUR SHIP — ${ship.weaponRooms.length} weapon bay(s)`,
          'One gun per bay. A bay needs a crew member aboard it to charge its gun.');

        if (!ship.weaponRooms.length) {
          const d = card(left, '#5a2a2a');
          title(d, 'No weapon bay on this hull', '#ff5566');
          sub(d, 'Buy a Weapons module in the MODULES tab — it converts an empty compartment.');
        }

        ship.weaponRooms.forEach((room, slot) => {
          const w   = ship.weapons[slot];
          const lvl = room.system?.level ?? 1;
          const d   = card(left, w ? '#ffb020' : '#2a3346');
          title(d, `BAY ${slot + 1}${w ? ' · ' + w.label : ' · empty'}`,
                w ? '#ffd780' : '#7a90a8');

          if (w) {
            const def = WEAPON_DEFS[w.defKey] || {};
            d.appendChild(statChips(def));
            // The single most confusing rule in the shop, spelled out:
            if ((def.powerCost ?? 1) > lvl) {
              sub(d, `⚠ This bay is level ${lvl} — it cannot feed a ⚡${def.powerCost} gun. ` +
                     `Upgrade the bay in MODULES or the gun will never fire.`, '#ff5566');
            } else {
              sub(d, `Bay level ${lvl} — enough for this gun.`, '#1aff8c');
            }
            btn(d, 'UNINSTALL → CARGO', true, () => {
              const r = s.uninstallWeapon(ship, slot);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            }, '#ffb020');
          } else {
            sub(d, `Bay level ${lvl}. Fit a gun from the cargo rack below, or buy one.`);
            ship.weaponCargo.forEach((key, ci) => {
              const wdef = WEAPON_DEFS[key] || {};
              btn(d, `FIT ${wdef.label ?? key}`, true, () => {
                const r = s.installFromCargo(ship, ci, slot);
                notify(r.message, r.ok ? 'good' : 'warn');
                _renderStation();
              }, '#1aff8c');
            });
            if (!ship.weaponCargo.length) sub(d, 'Cargo rack is empty.', '#4a6080');
          }
        });

        // ── cargo rack ──
        const rackHead = document.createElement('div');
        rackHead.style.cssText = 'color:#4db8ff;font:12px Orbitron,monospace;margin:14px 0 6px';
        rackHead.textContent = `CARGO RACK (${ship.weaponCargo.length})`;
        left.appendChild(rackHead);

        if (!ship.weaponCargo.length) {
          const d = card(left);
          sub(d, 'Nothing stowed. Guns you win or uninstall end up here — and anything still ' +
                 'on the rack when you dock goes into the base armoury.', '#4a6080');
        }
        ship.weaponCargo.forEach((key, ci) => {
          const def = WEAPON_DEFS[key] || {};
          const d = card(left);
          title(d, def.label ?? key, '#c8d8f0');
          d.appendChild(statChips(def));
          btn(d, `SELL — ${Math.floor((def.cost ?? 20) * 0.5)} CC`, true, () => {
            const r = s.sellCargoWeapon(ship, run, ci);
            notify(r.message, r.ok ? 'good' : 'warn');
            _renderStation();
          }, '#ff7c20');
        });

        // ── RIGHT: the store ──────────────────────────────────
        const freeBay = ship.weaponRooms.findIndex((r, i) => !ship.weapons[i]);
        const right = column('STATION STOCK',
          freeBay !== -1
            ? `A gun you buy is fitted straight into bay ${freeBay + 1}.`
            : 'All bays are full — a purchase goes onto the cargo rack.');

        if (!s.stock.weapons.length) {
          const d = card(right);
          sub(d, 'No weapons in stock at this station.', '#4a6080');
        }

        s.stock.weapons.forEach((item, i) => {
          const def  = item.def;
          const cost = def.cost;
          const afford = run.scrap >= cost;
          const d = card(right, item.sold ? '#2a3346' : (afford ? '#1e3a5c' : '#3a2020'));
          title(d, def.label, item.sold ? '#4a6080' : '#e8f4ff');
          d.appendChild(statChips(def));
          sub(d, def.description);
          if (item.sold) {
            sub(d, 'SOLD OUT', '#4a6080');
          } else {
            btn(d, `BUY — ${cost} CC`, afford, () => {
              const r = s.buyWeapon(i, _stationShip, run);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            }, afford ? '#1aff8c' : '#ff5566');
            if (!afford) sub(d, `You have ${run.scrap} CC — ${cost - run.scrap} short.`, '#ff5566');
          }
        });
        break;
      }

      case 'modules': {
        // ══ SHIP DIAGRAM SHOP ══════════════════════════════════
        // Left: new modules to buy. Right: a micro blueprint of the
        // ship — click an installed module to upgrade it in place,
        // or pick a new module and click an EMPTY compartment to
        // choose where it goes.
        const ship = _stationShip;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'grid-column:1/-1;display:flex;gap:12px;align-items:flex-start;padding:6px';
        container.appendChild(wrap);

        const left  = document.createElement('div');
        left.style.cssText = 'width:225px;flex:none';
        const right = document.createElement('div');
        right.style.cssText = 'flex:1';
        wrap.appendChild(left); wrap.appendChild(right);

        const hdr = (parent, txt, color) => {
          const h = document.createElement('div');
          h.style.cssText = `color:${color};font-size:10px;letter-spacing:2px;margin:2px 0 6px;border-bottom:1px solid #1e2d4a;padding-bottom:3px`;
          h.textContent = txt;
          parent.appendChild(h);
        };

        // ── LEFT: purchasable new modules (select → click a room) ──
        hdr(left, '◆ NEW MODULES', '#1aff8c');
        const offers = [];
        (s.stock.newModules ?? []).forEach((item, i) => {
          if (!item.sold && !ship.getSystem(item.type)) {
            offers.push({ kind: 'new', idx: i, label: SYSTEM_DEFS[item.type].label,
              desc: SYSTEM_DEFS[item.type].description, cost: item.cost });
          }
        });
        if (ship.weaponRooms.length < 3) {
          offers.push({ kind: 'wpn', label: `Weapon Module ${ship.weaponRooms.length + 1}`,
            desc: 'A fresh gun mount — one weapon per module.',
            cost: s.weaponModuleCost(ship) });
        }
        if (!offers.length) {
          const e = document.createElement('div');
          e.style.cssText = 'color:#4a6080;font-size:11px;padding:4px';
          e.textContent = 'Nothing new in stock here.';
          left.appendChild(e);
        }
        offers.forEach(off => {
          const sel = _shopPick &&
            _shopPick.kind === off.kind && _shopPick.idx === off.idx;
          const card = document.createElement('div');
          card.style.cssText = `background:${sel ? 'rgba(26,255,140,0.12)' : 'rgba(20,30,50,0.7)'};
            border:1px solid ${sel ? '#1aff8c' : '#1e2d4a'};border-radius:4px;
            padding:7px 9px;margin-bottom:6px;cursor:pointer`;
          const afford = run.scrap >= off.cost;
          card.innerHTML =
            `<div style="color:${afford ? '#e8f4ff' : '#5a7090'};font-size:12px">${off.label}</div>` +
            `<div style="color:#7a90a8;font-size:10px;margin:2px 0">${off.desc}</div>` +
            `<div style="color:#ffd700;font-size:11px">${off.cost} CC${sel ? '  — click a room ▶' : ''}</div>`;
          card.addEventListener('click', () => {
            if (!afford) { notify('Insufficient CC.', 'warn'); return; }
            _shopPick = sel ? null : { kind: off.kind, idx: off.idx };
            _shopRoomSel = null;
            _renderStation();
          });
          left.appendChild(card);
        });
        if (_shopPick) {
          const tip = document.createElement('div');
          tip.style.cssText = 'color:#1aff8c;font-size:10px;padding:4px;border:1px dashed #1aff8c;border-radius:4px';
          tip.textContent = '▶ Click an EMPTY compartment on the blueprint to install.';
          left.appendChild(tip);
        }

        // ── RIGHT: the ship blueprint ──
        hdr(right, '◆ SHIP BLUEPRINT — CLICK A MODULE TO UPGRADE', '#ffd700');
        const minX = Math.min(...ship.rooms.map(r => r.x));
        const minY = Math.min(...ship.rooms.map(r => r.y));
        const maxX = Math.max(...ship.rooms.map(r => r.x + r.w));
        const maxY = Math.max(...ship.rooms.map(r => r.y + r.h));
        const S = Math.min(420 / (maxX - minX), 250 / (maxY - minY));
        const bp = document.createElement('div');
        bp.style.cssText = `position:relative;width:${(maxX-minX)*S}px;height:${(maxY-minY)*S}px;
          background:rgba(7,9,16,0.8);border:1px solid #1e2d4a;border-radius:6px;margin-bottom:8px`;
        right.appendChild(bp);

        // elevator shafts (decorative)
        ship.elevators.shafts.forEach(sh => {
          const d = document.createElement('div');
          d.style.cssText = `position:absolute;left:${(sh.x - sh.width/2 - minX)*S}px;top:0;
            width:${sh.width*S}px;height:100%;background:rgba(20,28,48,0.7);border-left:1px solid #16233d;border-right:1px solid #16233d`;
          bp.appendChild(d);
        });

        const SHORT = { engines:'ENG', weapons:'WPN', shields:'SHD', piloting:'PIL',
          oxygen:'O₂', medbay:'MED', reactor:'RCT', cloaking:'CLK', autorepair:'RPR' };
        const COLORS = { engines:'#1aff8c', weapons:'#ff7c20', shields:'#4db8ff',
          piloting:'#ffd700', oxygen:'#8fd4ff', medbay:'#ff6f9c', reactor:'#ffb020',
          cloaking:'#cc44ff', autorepair:'#7dff9a' };

        ship.rooms.forEach(room => {
          const sys   = room.system;
          const empty = room.type === 'empty';
          const selR  = _shopRoomSel === room.id;
          const col   = empty ? '#3a4a63' : (COLORS[room.type] ?? '#4db8ff');
          const d = document.createElement('div');
          d.style.cssText = `position:absolute;box-sizing:border-box;
            left:${(room.x - minX)*S}px;top:${(room.y - minY)*S}px;
            width:${room.w*S}px;height:${room.h*S}px;
            border:${selR ? 2 : 1}px ${empty ? 'dashed' : 'solid'} ${selR ? '#ffffff' : col};
            background:${empty ? (_shopPick ? 'rgba(26,255,140,0.10)' : 'rgba(12,17,30,0.5)') : col + '22'};
            color:${col};font:9px "Share Tech Mono",monospace;
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            cursor:pointer;user-select:none`;
          let wTag = '';
          if (room.type === 'weapons') {
            const wi = ship.weaponRooms.findIndex(r => r === room);
            wTag = ` ${wi + 1}`;
          }
          d.innerHTML = empty
            ? `<div>EMPTY</div>${_shopPick ? '<div style="font-size:8px">▶ install</div>' : ''}`
            : `<div>${SHORT[room.type] ?? '?'}${wTag}</div>` +
              `<div style="font-size:8px">L${room.type === 'shields' ? (sys.level/2)+'/3' :
                 room.type === 'reactor' ? ship.reactor.level + '/' + ship.reactor.maxLevel :
                 sys.level + '/' + (sys.def?.maxLevel ?? 8)}</div>`;
          d.addEventListener('click', () => {
            if (empty && _shopPick) {
              const r = _shopPick.kind === 'wpn'
                ? s.buyWeaponModuleAt(ship, run, room.id)
                : s.buyNewModuleAt(_shopPick.idx, ship, run, room.id);
              notify(r.message, r.ok ? 'good' : 'warn');
              _shopPick = null; _shopRoomSel = null;
              _renderStation();
              return;
            }
            _shopRoomSel = selR ? null : room.id;
            _renderStation();
          });
          bp.appendChild(d);
        });

        // ── detail / upgrade panel for the selected module ──
        const selRoom = _shopRoomSel ? ship.getRoomById(_shopRoomSel) : null;
        if (selRoom) {
          const det = document.createElement('div');
          det.style.cssText = 'background:rgba(20,30,50,0.8);border:1px solid #1e2d4a;border-radius:5px;padding:9px 11px';
          right.appendChild(det);
          if (selRoom.type === 'empty') {
            det.innerHTML = '<div style="color:#7a90a8;font-size:11px">Empty compartment — pick a NEW module on the left, then click here to install it.</div>';
          } else if (selRoom.type === 'reactor') {
            const cost = ship.reactor.upgradeCost();
            const max  = ship.reactor.level >= ship.reactor.maxLevel;
            det.innerHTML =
              `<div style="color:#ffb020;font-size:13px">Reactor — level ${ship.reactor.level}/${ship.reactor.maxLevel}</div>` +
              `<div style="color:#7a90a8;font-size:10px;margin:3px 0">1 power per level. Hits knock out power until repaired.</div>`;
            const b = document.createElement('span');
            b.textContent = max ? 'MAX LEVEL' : `UPGRADE  ${cost} CC  (+1 power)`;
            b.style.cssText = `display:inline-block;margin-top:4px;padding:4px 10px;border:1px solid ${max||run.scrap<cost?'#333c50':'#ffb020'};border-radius:3px;font-size:11px;color:${max||run.scrap<cost?'#4a6080':'#ffb020'};cursor:${max||run.scrap<cost?'default':'pointer'}`;
            if (!max && run.scrap >= cost) b.addEventListener('click', () => {
              const r = s.buyReactorUpgrade(ship, run);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            });
            det.appendChild(b);
          } else {
            const sys   = selRoom.system;
            const idx   = ship.systems.indexOf(sys);
            const step  = sys.type === 'shields' ? 2 : 1;
            const max   = sys.level + step > (sys.def?.maxLevel ?? 8);
            const cost  = s.systemUpgradeCost(sys);
            const lvlTxt = sys.type === 'shields'
              ? `level ${sys.level/2}/3 (${Math.floor(sys.level/2)} layers)`
              : `level ${sys.level}/${sys.def?.maxLevel ?? 8}`;
            let extra = '';
            if (sys.type === 'weapons') {
              const wi = ship.weaponRooms.findIndex(r => r === selRoom);
              const gun = ship.weapons[wi];
              extra = gun ? `<div style="color:#ff7c20;font-size:10px">Mounted: ${gun.label} ⚡${gun.powerCost}</div>`
                          : '<div style="color:#4a6080;font-size:10px">Empty mount — buy a gun in the Weapons tab.</div>';
            }
            det.innerHTML =
              `<div style="color:#e8f4ff;font-size:13px">${sys.label} — ${lvlTxt}</div>` +
              `<div style="color:#7a90a8;font-size:10px;margin:3px 0">${sys.def?.description ?? ''}</div>` + extra;
            const b = document.createElement('span');
            b.textContent = max ? 'MAX LEVEL' : `UPGRADE  ${cost} CC`;
            b.style.cssText = `display:inline-block;margin-top:4px;padding:4px 10px;border:1px solid ${max||run.scrap<cost?'#333c50':'#ffd700'};border-radius:3px;font-size:11px;color:${max||run.scrap<cost?'#4a6080':'#ffd700'};cursor:${max||run.scrap<cost?'default':'pointer'}`;
            if (!max && run.scrap >= cost) b.addEventListener('click', () => {
              const r = s.upgradeSystemAt(ship, run, idx);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            });
            det.appendChild(b);
          }
        } else {
          const hint = document.createElement('div');
          hint.style.cssText = 'color:#4a6080;font-size:10px;padding:4px';
          hint.textContent = 'Click any module on the blueprint for details & upgrades.';
          right.appendChild(hint);
        }
        break;
      }

      case 'cargo': {
        // ══ CARGO MARKET ══════════════════════════════════════
        // Selling is a list, not a grid — you are not repacking here,
        // you are picking what leaves the ship. The grid itself lives
        // on the loot screen (C on the map).
        const ship = _stationShip;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'grid-column:1/-1;padding:6px';
        container.appendChild(wrap);

        const hold = ship?.cargo;
        if (!hold) {
          const d = document.createElement('div');
          d.style.cssText = 'color:#4a6080;font-size:11px;padding:10px';
          d.textContent = 'This hull has no cargo hold.';
          wrap.appendChild(d);
          break;
        }

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin:2px 0 10px';
        const portNote = s.type === 'military'
            ? '<span style="color:#ff5566">Fleet yard — contraband is SEIZED here, not bought.</span>'
          : s.type === 'science'
            ? '<span style="color:#4dd8ff">Research post — data cores and relics fetch a premium.</span>'
          : s.type === 'outpost'
            ? '<span style="color:#ffb020">Frontier outpost — low prices, but nobody asks about contraband.</span>'
            : '<span style="color:#1aff8c">Trade hub — fair prices across the board.</span>';
        hdr.innerHTML = `<div style="color:#4db8ff;font:13px Orbitron,monospace">CARGO HOLD
            <span style="color:#7a90a8;font:11px Share Tech Mono,monospace">
            &nbsp;${hold.usedCells()}/${hold.capacity} cells used</span></div>
          <div style="font-size:11px">${portNote}</div>`;
        wrap.appendChild(hdr);

        if (!hold.items.length) {
          const d = document.createElement('div');
          d.style.cssText = 'color:#4a6080;font-size:11px;padding:10px';
          d.textContent = 'The hold is empty. Board a derelict after a fight to fill it.';
          wrap.appendChild(d);
          break;
        }

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px';
        wrap.appendChild(grid);

        const sellOne = (it) => {
          const price = it.value(s.type);
          if (it.def.contraband && s.type === 'military') {
            hold.remove(it);
            Save.updateRun({ scrap: Math.max(0, (Save.getRun()?.scrap ?? 0) - 25) });
            notify(`Customs seized the ${it.label} — and fined you 25 CC`, 'alert');
          } else {
            hold.remove(it);
            Save.updateRun({ scrap: (Save.getRun()?.scrap ?? 0) + price });
            notify(`Sold ${it.label} for ${price} CC`, 'good');
          }
          Audio.sfx.uiClick?.();
          _renderStation();
        };

        [...hold.items].forEach(it => {
          const price = it.value(s.type);
          const seized = it.def.contraband && s.type === 'military';
          const c = document.createElement('div');
          c.style.cssText = `background:rgba(20,30,50,0.7);border:1px solid ${seized ? '#5a2a2a' : '#1e3a5c'};
            border-radius:5px;padding:9px 11px;display:flex;flex-direction:column;gap:4px`;
          c.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="color:${it.def.col};font:12px Orbitron,monospace">${it.label}</span>
              <span style="color:#7a90a8;font-size:10px">${it.w}x${it.h}</span>
            </div>
            <div style="color:#7a90a8;font-size:10px;line-height:1.35">${it.def.desc || ''}</div>
            ${it.damaged ? '<div style="color:#ff5566;font-size:10px">SPOILED — worth a fraction</div>' : ''}
            ${seized ? '<div style="color:#ff5566;font-size:10px">CONTRABAND — they will take it and fine you</div>' : ''}`;
          const b = document.createElement('span');
          b.textContent = seized ? 'HAND IT OVER' : `SELL  ${price} CC`;
          const col = seized ? '#ff5566' : '#1aff8c';
          b.style.cssText = `align-self:flex-start;margin-top:4px;padding:5px 12px;border:1px solid ${col};
            border-radius:3px;font-size:11px;color:${col};cursor:pointer;user-select:none;background:${col}14`;
          b.addEventListener('click', () => sellOne(it));
          c.appendChild(b);
          grid.appendChild(c);
        });

        const sellAll = document.createElement('span');
        const total = hold.items.reduce((n, it) =>
          n + (it.def.contraband && s.type === 'military' ? 0 : it.value(s.type)), 0);
        sellAll.textContent = `SELL EVERYTHING  →  ${total} CC`;
        sellAll.style.cssText = `display:inline-block;margin:12px 0 0;padding:7px 16px;border:1px solid #1aff8c;
          border-radius:3px;font-size:11px;color:#1aff8c;cursor:pointer;user-select:none;background:#1aff8c14`;
        sellAll.addEventListener('click', () => {
          [...hold.items].forEach(sellOne);
        });
        wrap.appendChild(sellAll);
        break;
      }

      case 'crew': {
        // ══ HIRING HALL ═══════════════════════════════════════
        // A recruit is a long-term investment, so the card shows what
        // you are actually buying: every skill, the corporation's real
        // perk (not just an XP list) and whether you have room aboard.
        const ship = _stationShip;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'grid-column:1/-1;padding:6px';
        container.appendChild(wrap);

        const aboard = ship.crew.filter(c => !c.dead).length;
        const ROOM   = 8;

        const bar = document.createElement('div');
        bar.style.cssText = `display:flex;justify-content:space-between;align-items:center;
          background:rgba(20,30,50,0.7);border:1px solid #1e2d4a;border-radius:5px;
          padding:8px 12px;margin-bottom:10px`;
        bar.innerHTML =
          `<span style="color:#4db8ff;font:13px Orbitron,monospace">HIRING HALL</span>` +
          `<span style="font-size:11px;color:${aboard >= ROOM ? '#ff5566' : '#7a90a8'}">` +
          `crew aboard: <b style="color:#c8d8f0">${aboard}/${ROOM}</b>` +
          `${aboard >= ROOM ? ' — no bunk free' : ''}</span>`;
        wrap.appendChild(bar);

        if (!s.stock.crew.length) {
          const e = document.createElement('div');
          e.style.cssText = 'color:#4a6080;padding:16px;font-size:12px';
          e.textContent = 'Nobody is looking for a berth at this port.';
          wrap.appendChild(e);
          break;
        }

        /** What the corporation ACTUALLY does for you, in plain words. */
        const CORP_PERK = {
          terra:    'Cyborg — powers the module they stand in, even with no reactor power.',
          pegasus:  'Vacuum-born — does not breathe, so hull breaches and boarding do not choke them.',
          aquarius: 'Fireproof hide — takes no burns while putting fires out.',
          phoenix:  'Hard-wired for a fight — learns their specialities twice as fast.',
        };

        const grid = document.createElement('div');
        grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px';
        wrap.appendChild(grid);

        s.stock.crew.forEach((item, i) => {
          const m    = item.member;
          const corp = CORP_DEFS[m.race] || {};
          const afford = run.scrap >= item.cost;
          const canHire = !item.sold && afford && aboard < ROOM;

          const c = document.createElement('div');
          c.style.cssText = `width:300px;background:rgba(20,30,50,0.7);
            border:1px solid ${item.sold ? '#2a3346' : (corp.color || '#1e2d4a')}66;
            border-radius:5px;padding:10px 12px;opacity:${item.sold ? 0.45 : 1}`;
          grid.appendChild(c);

          // Name + corporation badge
          const hd = document.createElement('div');
          hd.style.cssText = 'display:flex;align-items:center;gap:8px';
          hd.innerHTML =
            `<span style="width:16px;height:16px;border-radius:3px;background:${corp.color || '#4db8ff'};
                    display:inline-block"></span>` +
            `<span style="color:#e8f4ff;font-size:14px;font-weight:bold">${item.name}</span>` +
            `<span style="margin-left:auto;font-size:10px;color:${corp.color || '#7a90a8'};
                    border:1px solid ${corp.color || '#7a90a8'}55;border-radius:3px;padding:1px 6px">
                    ${corp.label || m.race}</span>`;
          c.appendChild(hd);

          // The perk that actually matters
          const perk = document.createElement('div');
          perk.style.cssText = 'color:#9fb4cc;font-size:10px;line-height:1.5;margin:8px 0 6px';
          perk.textContent = CORP_PERK[m.race] || 'Steady hand, no special training.';
          c.appendChild(perk);

          // EVERY skill, so two recruits can be compared
          const sk = document.createElement('div');
          sk.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;margin:6px 0';
          Object.entries(SKILL_DEFS).forEach(([key, def]) => {
            const lvl = m.skills?.[key]?.level ?? 0;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:10px';
            const pips = [0, 1, 2].map(l =>
              `<span style="width:9px;height:7px;display:inline-block;
                 background:${l < lvl ? def.color : '#1a2030'};border-radius:1px"></span>`).join('');
            row.innerHTML =
              `<span style="color:${lvl > 0 ? def.color : '#4a6080'};width:62px;white-space:nowrap;
                 overflow:hidden;text-overflow:ellipsis">${def.label}</span>` +
              `<span style="display:flex;gap:2px">${pips}</span>`;
            sk.appendChild(row);
          });
          c.appendChild(sk);

          // Price + hire
          const foot = document.createElement('div');
          foot.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:8px';
          const price = document.createElement('span');
          price.style.cssText = 'color:#ffd700;font-size:13px';
          price.textContent = `${item.cost} CC`;
          foot.appendChild(price);

          const b = document.createElement('span');
          b.textContent = item.sold ? 'HIRED'
                        : aboard >= ROOM ? 'NO BUNK FREE'
                        : !afford ? `NEED ${item.cost - run.scrap} MORE CC`
                        : 'SIGN THEM ON';
          b.style.cssText = `padding:5px 12px;border-radius:3px;font-size:11px;user-select:none;
            border:1px solid ${canHire ? '#1aff8c' : '#333c50'};
            color:${canHire ? '#1aff8c' : '#4a6080'};
            background:${canHire ? '#1aff8c14' : 'transparent'};
            cursor:${canHire ? 'pointer' : 'default'}`;
          if (canHire) b.addEventListener('click', () => {
            const r = s.buyCrew(i, ship, run);
            notify(r.message, r.ok ? 'good' : 'warn');
            _renderStation();
          });
          foot.appendChild(b);
          c.appendChild(foot);
        });
        break;
      }

      // ('reactor' tab retired — the reactor is upgraded by clicking
      //  its room on the Modules blueprint, like every other module)
    }
  }

  function _addCard(container, name, desc, price, canBuy, onBuy, extraClass = '') {
    const card = document.createElement('div');
    card.className = `shop-card ${extraClass}`;
    card.innerHTML = `
      <div class="shop-card-name">${name}</div>
      <div class="shop-card-desc">${desc}</div>
      <div class="shop-card-price">${price}</div>
      ${canBuy
        ? `<div class="shop-card-buy">BUY</div>`
        : `<div class="shop-card-buy disabled">${extraClass === 'sold-out' ? 'SOLD OUT' : 'CANNOT AFFORD'}</div>`
      }
    `;
    if (canBuy) {
      card.querySelector('.shop-card-buy').addEventListener('click', e => {
        e.stopPropagation();
        onBuy();
      });
    }
    container.appendChild(card);
  }

  // ── Graveyard screen ──────────────────────────────────────

  function showGraveyard() {
    const graves = Save.getGraveyard();
    const modal  = document.createElement('div');
    modal.style.cssText = `position:absolute;inset:0;background:rgba(7,8,15,0.95);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      z-index:200;font-family:var(--font-mono);color:var(--c-text);
      pointer-events:auto;`;

    const title = document.createElement('div');
    title.style.cssText = 'font-family:var(--font-display);font-size:1.4rem;color:#c8d8f0;margin-bottom:20px;letter-spacing:0.15em;';
    title.textContent = 'FALLEN CREW';
    modal.appendChild(title);

    if (!graves.length) {
      const empty = document.createElement('div');
      empty.style.color = '#4a6080';
      empty.textContent = 'No crew have fallen yet.';
      modal.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.style.cssText = 'display:grid;grid-template-columns:repeat(3,200px);gap:10px;max-height:400px;overflow-y:auto;';
      graves.slice(-30).reverse().forEach(g => {
        const card = document.createElement('div');
        card.style.cssText = 'background:#0d1120;border:1px solid #1e2d4a;border-radius:8px;padding:10px;';
        card.innerHTML = `
          <div style="color:#c8d8f0;font-weight:bold">${g.name}</div>
          <div style="color:#4a6080;font-size:0.65rem">Sector ${g.sector} — ${g.killer}</div>
        `;
        list.appendChild(card);
      });
      modal.appendChild(list);
    }

    const close = document.createElement('button');
    close.textContent = 'CLOSE';
    close.style.cssText = 'margin-top:24px;padding:10px 32px;border:1px solid #1e2d4a;background:transparent;color:#c8d8f0;font-family:var(--font-mono);cursor:pointer;letter-spacing:0.1em;';
    close.addEventListener('click', () => document.getElementById('ui-overlay').removeChild(modal));
    modal.appendChild(close);
    document.getElementById('ui-overlay').appendChild(modal);
  }

  // ── Update ───────────────────────────────────────────────

  function update(dt) {
    _updateNotifs(dt);
  }

  // ── Draw ─────────────────────────────────────────────────

  function draw(ctx, state) {
    const W = Renderer.getWidth(), H = Renderer.getHeight();
    _drawNotifs(ctx, W);
    _drawTooltip(ctx, W, H);

    // Skill panel — LEFT side, below crew roster (crew roster drawn by Renderer HUD)
    // Skill panel shows ONLY while HOVERING a crew member (sprite or
    // list row) — a selected crew no longer permanently covers the ship.
    const hovered = _hoveredCrew(state.playerShip);
    if (state.playerShip && hovered) {
      _drawSkillPanelLeft(ctx, hovered);
    }
  }

  /** Compact skill readout under the crew list on the left */
  function _drawSkillPanelLeft(ctx, crew) {
    const PX = 142;                 // right of crew roster
    const PY = 108;
    const PW = 150, PH = 210;

    ctx.fillStyle = 'rgba(13,17,32,0.94)';
    ctx.beginPath(); ctx.roundRect(PX, PY, PW, PH, 5); ctx.fill();
    ctx.strokeStyle = '#1a8cff'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#4db8ff';
    ctx.font = '12px Orbitron, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(crew.name, PX + 8, PY + 17);

    ctx.fillStyle = crew.color || '#8ba0b8';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(crew.corpLabel || '', PX + 8, PY + 31);
    ctx.fillStyle = '#8ba0b8';
    ctx.fillText(`HP ${Math.ceil(crew.hp)}/${crew.maxHp}`, PX + 78, PY + 31);

    let sy = PY + 42;
    Object.entries(crew.skills).forEach(([key, sk]) => {
      const def = SKILL_DEFS[key];
      if (!def) return;

      ctx.fillStyle = sk.level > 0 ? def.color : '#3a4a5e';
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText(def.label.slice(0, 9), PX + 8, sy + 9);

      for (let l = 0; l < MAX_SKILL_LEVEL; l++) {
        ctx.fillStyle = l < sk.level ? def.color : '#1a2030';
        ctx.fillRect(PX + 92 + l * 15, sy, 11, 10);
      }
      // XP progress toward next level
      if (sk.level < MAX_SKILL_LEVEL) {
        const xpMax = (SKILL_DEFS[key].xpPerLevel[sk.level] ?? 150);
        ctx.fillStyle = '#0a1010';
        ctx.fillRect(PX + 8, sy + 12, PW - 16, 3);
        ctx.fillStyle = def.color;
        ctx.fillRect(PX + 8, sy + 12, (PW - 16) * Utils.clamp(sk.xp / xpMax, 0, 1), 3);
      }
      sy += 20;
    });
  }

  // ── Public API ───────────────────────────────────────────

  return {
    notify,
    update,
    draw,
    showTooltip,
    hideTooltip,
    selectCrew,
    selectCrewGroup,
    getSelectedCrewAll,
    deselectCrew,
    getSelectedCrew,
    handlePowerClick,
    openStation,
    closeStation,
    showGraveyard,
    drawCrewPanel,
    drawSkillPanel,
  };

})();
