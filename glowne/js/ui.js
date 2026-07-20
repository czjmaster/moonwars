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
    const onSprite = ship.crew.find(c =>
      !c.dead && !c.dying && Utils.dist(mx, my, c.x, c.y - 14) < 20);
    if (onSprite) return onSprite;
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

    _stationEl.innerHTML = `
      <div class="station-header">
        <div class="station-name">${s.name}</div>
        <div class="station-type-badge">${s.type.toUpperCase()}</div>
        <div class="station-scrap">⬡ ${run?.scrap ?? 0} SCRAP</div>
      </div>
      <div class="station-tabs">
        ${['repair','weapons','modules','crew','reactor']
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

      case 'repair':
        _addCard(container, 'Hull Repair', `${s.stock.hullRepair} HP available`,
          `${s.hullRepairCost()} scrap/HP`,
          s.stock.hullRepair > 0 && run.scrap >= s.hullRepairCost(),
          () => {
            const r = s.buyHullRepair(5, _stationShip);
            notify(r.message, r.ok ? 'good' : 'warn');
            _renderStation();
          });

        _addCard(container, 'Fuel',
          `${s.stock.fuel} units available`,
          `${s.fuelCost()} scrap/unit`,
          s.stock.fuel > 0 && run.scrap >= s.fuelCost(),
          () => {
            const r = s.buyFuel(1, run);
            notify(r.message, r.ok ? 'good' : 'warn');
            _renderStation();
          });

        _addCard(container, 'Missiles',
          `${s.stock.missiles} missiles available`,
          `${s.missileCost()} scrap each`,
          s.stock.missiles > 0 && run.scrap >= s.missileCost(),
          () => {
            const r = s.buyMissiles(2, run);
            notify(r.message, r.ok ? 'good' : 'warn');
            _renderStation();
          });
        break;

      case 'weapons': {
        const ship = _stationShip;
        const hdr = (txt) => {
          const h = document.createElement('div');
          h.style.cssText = 'color:#4db8ff;font-size:11px;letter-spacing:2px;margin:10px 4px 4px';
          h.textContent = txt;
          container.appendChild(h);
        };
        const btn = (label, enabled, fn, color='#4db8ff') => {
          const b = document.createElement('span');
          b.textContent = label;
          b.style.cssText = `display:inline-block;margin:2px 4px 2px 0;padding:3px 8px;
            border:1px solid ${enabled?color:'#333c50'};border-radius:3px;font-size:10px;
            color:${enabled?color:'#4a6080'};cursor:${enabled?'pointer':'default'};user-select:none`;
          if (enabled) b.addEventListener('click', fn);
          return b;
        };
        const row = () => {
          const d = document.createElement('div');
          d.style.cssText = 'background:rgba(20,30,50,0.7);border:1px solid #1e2d4a;border-radius:4px;padding:8px 10px;margin:4px';
          container.appendChild(d);
          return d;
        };

        // ── Mounted guns: one per weapon MODULE ──
        hdr(`WEAPON MODULES (${ship.weaponRooms.length}) — one gun per module`);
        ship.weaponRooms.forEach((room, slot) => {
          const w = ship.weapons[slot];
          const d = row();
          const name = document.createElement('div');
          name.style.cssText = 'color:#e8f4ff;font-size:12px;margin-bottom:2px';
          name.textContent = w
            ? `Module ${slot + 1}: ${w.label}  ⚡${w.powerCost}  (module lvl ${room.system?.level ?? 1})`
            : `Module ${slot + 1}: — EMPTY —  (module lvl ${room.system?.level ?? 1})`;
          d.appendChild(name);
          if (w) {
            d.appendChild(btn('UNINSTALL → CARGO', true, () => {
              const r = s.uninstallWeapon(ship, slot);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            }, '#ffb020'));
          } else {
            ship.weaponCargo.forEach((key, ci) => {
              const wdef = WEAPON_DEFS[key];
              d.appendChild(btn(`INSTALL ${wdef?.label ?? key} ⚡${wdef?.powerCost ?? '?'}`, true, () => {
                const r = s.installFromCargo(ship, ci, slot);
                notify(r.message, r.ok ? 'good' : 'warn');
                _renderStation();
              }, '#1aff8c'));
            });
            if (!ship.weaponCargo.length) {
              const e = document.createElement('span');
              e.style.cssText = 'color:#4a6080;font-size:10px';
              e.textContent = 'cargo hold is empty';
              d.appendChild(e);
            }
          }
        });

        // ── Cargo hold ──
        if (ship.weaponCargo.length) {
          hdr('CARGO HOLD');
          ship.weaponCargo.forEach((key, ci) => {
            const def = WEAPON_DEFS[key];
            const d = row();
            const name = document.createElement('div');
            name.style.cssText = 'color:#c8d8f0;font-size:12px;margin-bottom:2px';
            name.textContent = `${def?.label ?? key}  ⚡${def?.powerCost ?? '?'}`;
            d.appendChild(name);
            d.appendChild(btn(`SELL ⬡${Math.floor((def?.cost ?? 20) * 0.5)}`, true, () => {
              const r = s.sellCargoWeapon(ship, run, ci);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            }, '#ff7c20'));
          });
        }

        // ── Store stock ──
        hdr('STORE');
        if (!s.stock.weapons.length) {
          const e = document.createElement('div');
          e.style.cssText = 'color:#4a6080;padding:10px';
          e.textContent = 'No weapons in stock.';
          container.appendChild(e);
        }
        s.stock.weapons.forEach((item, i) => {
          _addCard(container, `${item.def.label}  ⚡${item.def.powerCost}`,
            `${item.def.description}  ·  Needs ⚡${item.def.powerCost} power from its module.`,
            `${item.def.cost} scrap`,
            !item.sold && run.scrap >= item.def.cost,
            () => {
              const r = s.buyWeapon(i, _stationShip, run);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            },
            item.sold ? 'sold-out' : '');
        });
        break;
      }

      case 'modules': {
        const hdr = (txt, color='#4db8ff') => {
          const h = document.createElement('div');
          h.style.cssText = `color:${color};font-size:11px;letter-spacing:2px;margin:10px 4px 4px;border-bottom:1px solid #1e2d4a;padding-bottom:3px`;
          h.textContent = txt;
          container.appendChild(h);
        };

        hdr('◆ NEW MODULES — BUY & INSTALL', '#1aff8c');
        if (!(s.stock.newModules ?? []).length &&
            !(_stationShip.weaponRooms.length < 3 && _stationShip.rooms.some(r => r.type === 'empty'))) {
          const e = document.createElement('div');
          e.style.cssText = 'color:#4a6080;padding:6px 10px;font-size:11px';
          e.textContent = 'Nothing new in stock at this station.';
          container.appendChild(e);
        }
        // Brand-new modules in stock (random per station)
        (s.stock.newModules ?? []).forEach((item, i) => {
          const def = SYSTEM_DEFS[item.type];
          const owned = !!_stationShip.getSystem(item.type);
          _addCard(container, `NEW: ${def.label}`,
            def.description,
            owned ? 'INSTALLED' : `${item.cost} scrap`,
            !item.sold && !owned && run.scrap >= item.cost &&
              _stationShip.rooms.some(r => r.type === 'empty'),
            () => {
              const r = s.buyNewModule(i, _stationShip, run);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            },
            (item.sold || owned) ? 'sold-out' : '');
        });

        // Buy NEW weapon modules (converts an empty room; max 3 total)
        if (_stationShip.weaponRooms.length < 3 &&
            _stationShip.rooms.some(r => r.type === 'empty')) {
          const wmCost = s.weaponModuleCost(_stationShip);
          _addCard(container, `Weapon Module ${_stationShip.weaponRooms.length + 1}`,
            'Converts an empty room into a new weapon module (mount a gun in it).',
            `${wmCost} scrap`,
            run.scrap >= wmCost,
            () => {
              const r = s.buyWeaponModule(_stationShip, run);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            });
        }

        hdr('◆ INSTALLED MODULES — UPGRADE', '#ffd700');
        // Every installed system can ALWAYS be upgraded here.
        // Price grows with level. Reactor has its own tab.
        const wCount = { n: 0 };
        _stationShip.systems.forEach((sys, idx) => {
          if (sys.type === 'reactor') return;
          let label = sys.label;
          if (sys.type === 'weapons') { wCount.n++; label = `Weapons module ${wCount.n}`; }
          const step  = sys.type === 'shields' ? 2 : 1;
          const atMax = sys.level + step > (sys.def?.maxLevel ?? 8);
          const cost  = s.systemUpgradeCost(sys);
          const lvlTxt = sys.type === 'shields'
            ? `Level ${sys.level / 2}/3 (${Math.floor(sys.level / 2)} layer${sys.level >= 4 ? 's' : ''})`
            : `Level ${sys.level}/${sys.def?.maxLevel ?? 8}`;
          let extra = '';
          if (sys.type === 'weapons') {
            const wi  = _stationShip.weaponRooms.findIndex(r => r.system === sys);
            const gun = _stationShip.weapons[wi];
            extra = gun ? `  ·  Mounted: ${gun.label} ⚡${gun.powerCost}` : '  ·  Empty mount';
          }
          _addCard(container, `${label}  [INSTALLED]`,
            `${lvlTxt} — ${sys.def?.description ?? ''}${extra}`,
            atMax ? 'MAX LEVEL' : `${cost} scrap`,
            !atMax && run.scrap >= cost,
            () => {
              const r = s.upgradeSystemAt(_stationShip, run, idx);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            },
            atMax ? 'sold-out' : '');
        });
        break;
      }

      case 'crew':
        if (!s.stock.crew.length) {
          container.innerHTML = '<div style="color:#4a6080;padding:20px">No crew available for hire.</div>';
          break;
        }
        s.stock.crew.forEach((item, i) => {
          const skill = Object.entries(item.member.skills).find(([,v]) => v.level > 0);
          _addCard(container, item.name,
            skill ? `Specialised: ${SKILL_DEFS[skill[0]].label}` : 'General crew',
            `${item.cost} scrap`,
            !item.sold && run.scrap >= item.cost,
            () => {
              const r = s.buyCrew(i, _stationShip, run);
              notify(r.message, r.ok ? 'good' : 'warn');
              _renderStation();
            },
            item.sold ? 'sold-out' : '');
        });
        break;

      case 'reactor':
        if (!s.stock.reactorUpgrade) {
          container.innerHTML = '<div style="color:#4a6080;padding:20px">No reactor upgrades available.</div>';
          break;
        }
        const cost = s.reactorCost(_stationShip);
        _addCard(container, 'Reactor Upgrade',
          `Current level: ${_stationShip.reactor.level}/${_stationShip.reactor.maxLevel}`,
          `${cost} scrap`,
          run.scrap >= cost,
          () => {
            const r = s.buyReactorUpgrade(_stationShip, run);
            notify(r.message, r.ok ? 'good' : 'warn');
            _renderStation();
          });
        break;
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
