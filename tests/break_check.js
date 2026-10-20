'use strict';
/* ============================================================
   MOON WARS — break_check.js  (update54, extended in 55-60)

   THE POINT: a test that does not fail on a broken build is worth
   nothing. This reverts each fix in update54, ONE AT A TIME, runs the
   suites, and reports any revert the tests slept through.

   It edits the real files and puts them back afterwards — including on
   a crash — so it must be run on a clean tree.

   Usage:  node tests/break_check.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const F = (n) => path.join(ROOT, 'js', n);

/* Each entry: what was fixed, which file, and the exact text to swap
   back to the broken version. `from` must appear EXACTLY once. */
const BREAKS = [
  {
    name: '#4 doors — put them back under the commander',
    file: F('game.js'),
    from: "           room WALLS, so nothing else claims that pixel. */\n        d.toggle();",
    to:   "           room WALLS, so nothing else claims that pixel. */\n        if (_needCommander('the doors')) return true;\n        d.toggle();",
  },
  {
    name: '#1 karma colours painted with no commander in the chair',
    file: F('game.js'),
    /* update136: the window is EventView's now; the chair is asked here */
    from: "      reporter: _eventReporter(), hasCommander: _hasCommander(),",
    to:   "      reporter: _eventReporter(), hasCommander: true,",
  },
  {
    name: '#2 air — breathing back to the old trickle',
    file: F('oxygen.js'),
    from: "  BREATHING:      0.04,",
    to:   "  BREATHING:      0.014,",
  },
  {
    name: '#2 air — a hull breach back to the old leak',
    file: F('oxygen.js'),
    from: "  DRAIN_BREACH:   0.16,",
    to:   "  DRAIN_BREACH:   0.07,",
  },
  {
    name: '#3 the red wash over a broken module, restored',
    file: F('systems.js'),
    from: "    if (this.ionDamage > 0) {\n      ctx.fillStyle = `rgba(77,184,255,",
    to:   "    if (this.damagedLevels > 0) {\n      const a = Math.min(0.5, this.damagedLevels / this.level * 0.5);\n      ctx.fillStyle = `rgba(255,45,68,${a})`;\n      ctx.fillRect(x, y, w, h);\n    }\n    if (this.ionDamage > 0) {\n      ctx.fillStyle = `rgba(77,184,255,",
  },
  {
    name: '#10 medbay reads operators again, so the cat is skipped',
    file: F('ship.js'),
    // Re-aimed in update78: the medbay stopped being a special case in
    // `sys.crew` (a patient is not an operator). The question is the
    // same one — does the ward see the ship's cat — and it is asked of
    // `medbayPatients` now, which is the only list of who it treats.
    from: "    return this.crew.filter(c =>\n      c && !c.dead && c.roomId === roomId && c.inRoom !== false &&\n      c.isPlayer === this.isPlayer);",
    to:   "    return this.crewOperating(roomId);",
  },
  {
    name: '#10 the station clinic turns the cat away again',
    file: F('station.js'),
    // Re-aimed in update84: the vermin clauses left with the vermin.
    from: '      c.isPlayer && !c.dead && (c.hp < c.maxHp',
    to:   '      c.isPlayer && !c.isPet && !c.dead && (c.hp < c.maxHp',
  },
  {
    /* Re-aimed in update75: the scratch-shelf dance moved INTO
       `Ship.uninstallWeapon`, so the old anchor stopped existing. The
       rule it guards has not changed — the gun leaves the mount only
       once the crate has a place. */
    name: '#14 uninstall unbolts first and loses the gun',
    file: F('ship.js'),
    from: "    if (!this.boxWeapon(w.defKey, dest)) return null;  // no room \u2014 she keeps her gun",
    to:   "    this.boxWeapon(w.defKey, dest);",
  },
  {
    name: '#13 SELL sells on the first click again',
    file: F('basescreen.js'),
    from: "        _confirm = { act: 'doSellShip', arg,",
    to:   "        return _act('doSellShip', arg);\n        // eslint-disable-next-line no-unreachable\n        _confirm = { act: 'doSellShip', arg,",
  },
  {
    name: '#11 the hangar resets to the first hull',
    file: F('basescreen.js'),
    from: "      const want = b.lastShipKey;",
    to:   "      const want = null;",
  },
  {
    name: '#7 the base picks the first four hands for the player',
    file: F('basescreen.js'),
    from: "    if (remembered.length) remembered.forEach(id => _picked.add(id));\n    else if (!b.lastCrew) homeCrew.slice(0, 4).forEach(c => _picked.add(c.id));",
    to:   "    homeCrew.slice(0, 4).forEach(c => _picked.add(c.id));",
  },
  {
    name: '#8 the enemy badge hangs on the stale flag again',
    file: F('renderer.js'),
    from: "    if (foeAlive && typeof Commander !== 'undefined' && Commander.enemy && Commander.enemy()) {",
    to:   "    if (typeof Commander !== 'undefined' && Commander.enemy && Commander.enemy()) {",
  },
  {
    name: '#15 the boss chip goes back to the exit the boss never takes',
    file: F('game.js'),
    from: "    if (!_bossJustBeaten()) return null;",
    to:   "    if (true) return null;",
  },
  {
    name: '#6 recruits draw names with replacement again',
    file: F('base.js'),
    from: "    const c = new CrewMember({ name: pickUniqueName(CREW_NAMES, [...takenNames(), ...CrewMember.namesInPlay()]) });",
    to:   "    const c = new CrewMember({ name: Utils.pick(CREW_NAMES) });",
  },
  {
    name: '#6 rename lets two people share a name',
    file: F('base.js'),
    from: "    if (clash) return { ok: false, message: `${clean} is already somebody aboard.` };",
    to:   "    if (false) return { ok: false, message: 'unreachable' };",
  },
  {
    name: '#9 victory declared the moment their hull dies',
    file: F('combat.js'),
    from: "      if (!this.intrudersAboard()) {",
    to:   "      if (true) {",
  },
  {
    name: '#9 our hands bandage their boarders again',
    file: F('ship.js'),
    from: "      if (body.isPlayer !== this.isPlayer) return;\n      /* AND NOBODY KNEELS DOWN",
    to:   "      /* AND NOBODY KNEELS DOWN",
  },
  {
    name: '#9 first aid in the middle of a brawl again',
    file: F('ship.js'),
    // Re-aimed in update78: the comment this used to end on went out
    // with the heal-in-place code. The line after it now is the medic.
    from: "      if (this.roomContested(body.roomId)) return;\n      const medic = this.crewInRoom(body.roomId)",
    to:   "      const medic = this.crewInRoom(body.roomId)",
  },
  {
    name: '#5 pips drawn as one bar again',
    file: F('renderer.js'),
    // update128: the loop also frames each box (the hostile's red edge)
    from: "    for (let i = 0; i < n; i++) {\n      ctx.fillStyle = i < lit ? col : '#1a2030';\n      ctx.fillRect(x + i * (bw + gap), y, bw, h);",
    to:   "    ctx.fillStyle = col;\n    ctx.fillRect(x, y, w * (v / (max || 1)), h);\n    for (let i = 0; i < 0; i++) {",
  },
  {
    name: '#5 the orders panel back to its old width',
    file: F('renderer.js'),
    from: "  const ORDER_BW = 48, ORDER_BH = 18, ORDER_GAP = 4, ORDER_X = 14;",
    to:   "  const ORDER_BW = 58, ORDER_BH = 18, ORDER_GAP = 4, ORDER_X = 14;",
  },
  {
    name: '#12 gun strips dimmed by the cloak again',
    file: F('ship.js'),
    from: "    if (cloaked) ctx.globalAlpha = 1;\n    this._drawWeaponMounts(ctx);",
    to:   "    this._drawWeaponMounts(ctx);",
  },
  /* ── SUBTLER REVERTS ──────────────────────────────────────
     The obvious ones above were all caught on the second pass. These
     break the CORNERS of the same fixes — the places where a test can
     pass for the wrong reason. */
  {
    name: '#9 a rat in the duct counts as a boarding party',
    file: F('combat.js'),
    // Re-aimed in update84: a rat is in `ship.pests` now, so the leak would be counting THAT list.
    from: '    if (p.crew.some(c => c && c.alive && !c.isPlayer)) return true;',
    to:   '    if (p.crew.some(c => c && c.alive && !c.isPlayer) || (p.pests ?? []).some(x => x.alive)) return true;',
  },
  {
    name: '#9/#10 the medbay treats people through a brawl',
    file: F('ship.js'),
    from: "  medbayPatients(roomId) {\n    if (this.roomContested(roomId)) return [];",
    to:   "  medbayPatients(roomId) {\n    if (false) return [];",
  },
  {
    name: '#15 the boss chip remembers THAT it paid, not WHICH boss',
    file: F('game.js'),
    from: "    if (!hull || _bossChipPaidFor === hull) return null;",
    to:   "    if (!hull || _bossChipPaidFor) return null;",
  },
  {
    name: '#5 a man on his last hit point shows an empty row',
    file: F('renderer.js'),
    from: "    const lit = v <= 0 ? 0 : Math.max(1, Math.round((v / (max || 1)) * n));",
    to:   "    const lit = Math.round((v / (max || 1)) * n);",
  },
  {
    name: '#6 rename accepts a blank name',
    file: F('base.js'),
    from: "    if (!clean) return { ok: false, message: 'A name cannot be empty.' };",
    to:   "    if (false) return { ok: false, message: 'unreachable' };",
  },
  {
    name: '#2 one pip of power no longer holds the air (refill left behind)',
    file: F('oxygen.js'),
    /* Re-aimed in update82: `REFILL_PER_POWER` was a PER-ROOM figure
       and is gone; `PER_POWER` is the hull's whole production, written
       as `BREATHING * 3` so one pip is three mouths by construction.
       Halving it is the same breakage it always was — a module that
       can no longer hold the air it is specified to hold. */
    from: "  PER_POWER:      0.04 * 3,",
    to:   "  PER_POWER:      0.04 * 1.5,",
  },
  {
    name: '#13 CANCEL sells anyway',
    file: F('basescreen.js'),
    from: "      case 'confirmNo':  _confirm = null; break;",
    to:   "      case 'confirmNo':  { const c0 = _confirm; _confirm = null; if (c0) return _act(c0.act, c0.arg); break; }",
  },

  /* ── update55 ─────────────────────────────────────────── */
  {
    name: '#1 their crew counted only on their own deck',
    file: F('game.js'),
    from: "        _enemyCrewAliveCount() === 0) {\n      _derelictOffered = true;",
    to:   "        _enemyShip.crew.filter(c => !c.isPlayer && c.alive).length === 0) {\n      _derelictOffered = true;",
  },
  {
    name: '#1 the void does not count for the victory check either',
    file: F('combat.js'),
    from: "    return this.inFlightIntruders() > 0;",
    to:   "    return false;",
  },
  {
    name: '#2 TAB always jumps back to the top of the list',
    file: F('game.js'),
    from: "    UI.selectCrew(roster[at === -1 ? 0 : (at + 1) % roster.length]);",
    to:   "    UI.selectCrew(roster[0]);",
  },
  {
    name: '#2 TAB steps onto the dead',
    file: F('game.js'),
    from: "      .filter(c => c && c.isPlayer && c.alive && !c.isPet);",
    to:   "      .filter(c => c && c.isPlayer && !c.isPet);",
  },
  {
    name: '#4 an open hatch is cut through anyway',
    file: F('game.js'),
    from: "    if (waiting > 0 && !party.doorBroken &&\n        (party.entryDoor.mode === 'open' || party.entryDoor.openness >= 1)) {",
    to:   "    if (false) {",
  },
  {
    name: '#4 their commander does not seal the ship',
    file: F('game.js'),
    from: "    if (typeof Commander !== 'undefined' && Commander.enemy?.() && !_enemySealed) {",
    to:   "    if (false) {",
  },
  {
    name: '#5 every hostile back to one flat red',
    file: F('crew.js'),
    from: "    const corp = CORP_DEFS[this.race];\n    return corp ? corp.color : CrewMember.ENEMY_COLOR;",
    to:   "    return CrewMember.ENEMY_COLOR;",
  },
  {
    name: '#5 no side ring on hostiles',
    file: F('crew.js'),
    // Re-aimed in update84: `!isPet` went — no hostile animal is drawn by CrewMember any more.
    // update128: the ring is gone (jj); the side is the red edge on his health boxes
    from: "                          this.isPlayer ? null : CrewMember.ENEMY_COLOR);",
    to:   "                          null);",
  },
  {
    name: '#5 enemy crews stop scaling with the sector',
    file: F('crew.js'),
    from: "  const nSkills = s >= 3 ? 3 : 2;\n  const base    = s >= 5 ? 2 : 1;\n  const topUp   = s >= 5 ? 3 : (s >= 3 ? 2 : 1);",
    to:   "  const nSkills = 2;\n  const base    = 1;\n  const topUp   = 1;",
  },
  {
    name: '#6 Terra back to a hundred hit points',
    file: F('crew.js'),
    from: "    maxHp: 80,",
    to:   "    /* no maxHp */",
  },
  {
    name: '#6 an explicit maxHp no longer wins (old saves re-cut)',
    file: F('crew.js'),
    // Re-aimed in update87: the frame is read off the rolled race now.
    from: '    this.maxHp = cfg.maxHp ?? frame;',
    to:   '    this.maxHp = frame;',
  },
  {
    name: '#7 RENAME back on top of the skill pips',
    file: F('basescreen.js'),
    from: "      _btn(ctx, x + 306, y + 56, 50, 10, 'RENAME',",
    to:   "      _btn(ctx, x + 300, y + 40, 54, 16, 'RENAME',",
  },
  {
    name: '#8 the barracks goes back to a bar',
    // Re-aimed in update112: the barracks card is Renderer.drawCrewCard.
    file: F('renderer.js'),
    from: "      _pips(ctx, tx + 16, y + 40, 68, 7, F.hp, F.max, _hpCol(F.pct));",
    to:   "      ctx.fillStyle = '#0a1018'; ctx.fillRect(tx + 16, y + 40, 68, 7);\n      ctx.fillStyle = _hpCol(F.pct); ctx.fillRect(tx + 16, y + 40, Math.round(68 * F.pct), 7);",
  },

  /* ── update56 ─────────────────────────────────────────── */
  {
    name: '#He3 the ore is fuel after all',
    file: F('cargo.js'),
    from: "    w: 1, h: 1, value: 30, col: '#cfe4ff', kind: 'trade', tag: 'he3',",
    to:   "    w: 1, h: 1, value: 30, col: '#cfe4ff', kind: 'fuel', tag: 'he3',",
  },
  {
    name: '#He3 never drifts in a wreck',
    file: F('cargo.js'),
    from: "    ['he3_ore',        2 + Math.floor(sector / 2)],",
    to:   "    ['he3_ore',        0],",
  },
  {
    name: '#He3 counting by tag ignores damage',
    file: F('cargo.js'),
    from: "      (n, it) => n + (it.def.tag === tag && !it.damaged\n        ? (it.isStack ? it.qty : 1) : 0), 0);",
    to:   "      (n, it) => n + (it.def.tag === tag\n        ? (it.isStack ? it.qty : 1) : 0), 0);",
  },
  {
    name: '#He3 the port charges before checking the hold',
    file: F('station.js'),
    from: "    const probe = CargoGrid.deserialise(hold.serialise());\n    avail -= probe.addStack('he3_ore', avail);\n    if (avail <= 0) return { ok: false, message: 'No room in the hold for ore.' };",
    to:   "    /* no dry run */",
  },
  {
    name: '#He3 a port never stocks any',
    file: F('station.js'),
    from: "      he3: ri(0, 2 + Math.floor(s / 2)),",
    to:   "      he3: 0,",
  },
  {
    name: '#region a new run has no address',
    file: F('save.js'),
    from: "      region:    DEFAULT_REGION,",
    to:   "      region:    undefined,",
  },
  {
    name: '#region an old save is not migrated',
    file: F('save.js'),
    from: "    if (_data && _data.run && !_data.run.region) _data.run.region = DEFAULT_REGION;",
    to:   "    /* no migration */",
  },
  {
    name: '#region the map stops saying where it is',
    file: F('renderer.js'),
    from: "    ctx.fillText(regionLabel ? `${regionLabel} · SECTOR ${sectorMap.sector} MAP`\n                             : `SECTOR ${sectorMap.sector} MAP`, ox - 10, oy - 18);",
    to:   "    ctx.fillText(`SECTOR ${sectorMap.sector} MAP`, ox - 10, oy - 18);",
  },
  {
    name: '#gate the tab is gone',
    file: F('basescreen.js'),
    // update127: the tabs come from TAB_GROUPS since update115 (TABS was dead)
    from: "['WANTED', 'WANTED'], ['GATE', 'GATE']] },",
    to:   "['WANTED', 'WANTED']] },",
  },
  {
    name: '#gate the parts list stops reading the shelf',
    file: F('basescreen.js'),
    from: "    if (part.tag) return g.countOfTag ? g.countOfTag(part.tag) : 0;",
    to:   "    if (part.tag) return 0;",
  },
  {
    name: '#gate it grows a BUILD button',
    file: F('basescreen.js'),
    from: "    ctx.fillText('Construction is not available in this version — keep the parts.',",
    to:   "    _btn(ctx, px + pw / 2 - 60, py + ph - 44, 120, 24, 'BUILD', { act: 'buildGate' });\n    ctx.fillText('Construction is not available in this version — keep the parts.',",
  },
  {
    name: '#hangar a returning hull is refused again',
    file: F('base.js'),
    from: "    if (!returning && b.ships.length >= shipSlots()) return false;",
    to:   "    if (b.ships.length >= shipSlots()) return false;",
  },
  {
    /* This revert used to be a COMMENT — it changed nothing at all and
       was reported as a leak, which is exactly right: a revert that
       does not revert anything is worse than no revert. It now removes
       the cap from BUYING, which is the half that must stay. */
    name: '#hangar the cap stops applying to purchases too',
    file: F('base.js'),
    from: "    if (b.ships.length >= shipSlots()) {\n      return { ok: false, message: 'No free berth — buy another slot.' };\n    }",
    to:   "    if (false) {\n      return { ok: false, message: 'unreachable' };\n    }",
  },

  /* ── update57 ─────────────────────────────────────────── */
  {
    name: '#roster the barracks goes back to raw array order',
    file: F('base.js'),
    from: "    return [...b.barracks].sort((x, y) => (x.joined ?? 0) - (y.joined ?? 0));",
    to:   "    return [...b.barracks];",
  },
  {
    name: '#roster the ticket is dropped when a man flies',
    file: F('crew.js'),
    from: "      joined: this.joined,",
    to:   "      /* ticket not carried */",
  },
  {
    name: '#roster a returning hand is re-ticketed to the bottom',
    file: F('base.js'),
    from: "    if (typeof data.joined !== 'number') data.joined = b.joinedSeq++;",
    to:   "    data.joined = b.joinedSeq++;",
  },
  {
    name: '#continue the title screen keeps it',
    file: F('game.js'),
    from: "const MENU_ITEMS = ['ENTER BASE','OPTIONS','NEW GAME'];",
    to:   "const MENU_ITEMS = ['ENTER BASE','CONTINUE','OPTIONS','NEW GAME'];",
  },
  {
    name: '#continue the base does not offer it',
    file: F('basescreen.js'),
    // Re-aimed in update111 (the bar became the briefing summary).
    from: "      _btn(ctx, W - 60 - 220, y + 10, 220, 34, 'CONTINUE',",
    to:   "      if (false) _btn(ctx, W - 60 - 220, y + 10, 220, 34, 'CONTINUE',",
  },
  {
    name: '#continue pressing it does nothing',
    file: F('basescreen.js'),
    from: "      case 'continue': return 'continue';",
    to:   "      case 'continue': return null;",
  },
  {
    name: '#launch a live contract is written off in silence',
    file: F('basescreen.js'),
    from: "        if (typeof Save !== 'undefined' && Save.hasShipInFlight && Save.hasShipInFlight()) {",
    to:   "        if (false) {",
  },
  {
    name: '#launch the warning fires on a blank run record too',
    file: F('save.js'),
    from: "    return !!(_data.run && _data.run.shipKey);",
    to:   "    return _data.run !== null;",
  },
  {
    name: '#launch the button stops warning on its face',
    file: F('basescreen.js'),
    from: "              : flying  ? 'a contract is still out there'",
    to:   "              : flying  ? 'contract begins'",
  },

  /* update57, corners */
  {
    name: '#roster tickets collide (one pass instead of two)',
    file: F('base.js'),
    from: "    list.forEach(c => {\n      if (typeof c.joined === 'number') next = Math.max(next, c.joined + 1);\n    });\n    list.forEach(c => { if (typeof c.joined !== 'number') c.joined = next++; });",
    to:   "    list.forEach(c => {\n      if (typeof c.joined !== 'number') c.joined = next++;\n      else next = Math.max(next, c.joined + 1);\n    });",
  },
  {
    name: '#continue offered with nothing in the air',
    file: F('basescreen.js'),
    from: "    const flying = (typeof Save !== 'undefined' && Save.hasShipInFlight\n                    && Save.hasShipInFlight());",
    to:   "    const flying = true;",
  },
  {
    name: '#launch the question stops saying what it costs',
    file: F('basescreen.js'),
    from: "                       detail: 'That ship, her crew and her whole hold are written off. '",
    to:   "                       detail: 'Go on then. '",
  },
  /* '#launch CANCEL launches anyway' was here and its anchor never
     matched anything — the script said ANCHOR MISSING, which is the
     right answer to a revert that reverts nothing. Dropped rather than
     re-aimed: CANCEL goes through the ONE `confirmNo` case, and
     '#13 CANCEL sells anyway' above already breaks exactly that. Two
     reverts of one line would just be two copies of one test. */

  /* ── update58 ─────────────────────────────────────────── */
  {
    name: '#ore the HUD readout is gone',
    file: F('renderer.js'),
    // Re-aimed in update130: the plate moved its slots a pixel or two.
    from: "      ctx.fillText(`He3 ${ore}`, resX + 249, 28);",
    to:   "      /* no readout */",
  },
  {
    name: '#ore the readout reads a mirror instead of the hold',
    file: F('renderer.js'),
    from: "      const ore = ship.cargo?.countOfTag ? ship.cargo.countOfTag('he3') : 0;",
    to:   "      const ore = run.he3 ?? 0;",
  },
  {
    name: '#ore the map stops showing it',
    file: F('renderer.js'),
    from: "        ctx.fillText(`He3 ${ore}`, ox + 540, oy - 18);",
    to:   "        /* no readout */",
  },
  {
    name: '#ore the pictogram is dropped',
    file: F('renderer.js'),
    // Re-aimed in update130: the pictogram is the isotope now.
    from: "      drawStatIcon(ctx, 'he3', resX + 233, 17, 12, oreCol);",
    to:   "      /* no icon */",
  },
  {
    name: '#moons the table holds only Luna again',
    file: F('save.js'),
    from: "    europa:    { key: 'europa',    label: 'EUROPA',    body: 'Jupiter', locked: true,",
    to:   "    europa_disabled: { key: 'europa', label: 'EUROPA', body: 'Jupiter', locked: true,",
  },
  {
    name: '#moons every moon reads as open',
    file: F('save.js'),
    from: "  function regionUnlocked(key) { return unlockedRegions().includes(key); }",
    to:   "  function regionUnlocked(key) { return true; }",
  },
  {
    name: '#moons the Gate stops listing them',
    file: F('basescreen.js'),
    from: "      ctx.fillText('DESTINATIONS', dx, dy0);",
    to:   "      /* no list */",
  },
  {
    name: '#moons the contracts lose their address',
    file: F('basescreen.js'),
    // Re-aimed in update113 (the line is under the moon, on the destination panel).
    from: "    ctx.fillText(`${reg.label} · CONTRACTS — more moons open with the Moon Gate`, P.x + 14, P.y + 68);",
    to:   "    ctx.fillText(`CONTRACTS`, P.x + 14, P.y + 68);",
  },

  /* ── update59 ─────────────────────────────────────────── */
  {
    name: '#ammo an empty rack refuses in silence again',
    file: F('combat.js'),
    from: "    const refusal = this.fireRefusal(weapon);\n    if (refusal) return refusal;",
    to:   "    if (!weapon || !weapon.armed) return;\n    if (this.state !== COMBAT_STATE.ACTIVE) return;\n    if (weapon.def.missileUse > 0) {\n      const h = this.playerShip?.cargo;\n      if (h && h.countOf('missiles') < weapon.def.missileUse) return;\n    }",
  },
  {
    name: '#ammo the refusal stops naming the ammo',
    file: F('combat.js'),
    from: "        return `${weapon.label} is out of ammo — it needs ${need} ${a.word}`",
    to:   "        return `cannot fire`;\n        return `${weapon.label} needs ${need} ${a.word}`",
  },
  {
    name: '#ammo every refusal says the same thing',
    file: F('combat.js'),
    from: "    if (!weapon.armed)    return `${weapon.label} is still charging`;",
    to:   "    if (!weapon.armed)    return `${weapon.label} is out of ammo`;",
  },
  {
    name: '#ammo an unmanned bay blocks the shot (invented rule)',
    file: F('combat.js'),
    from: "    if (!weapon.armed)    return `${weapon.label} is still charging`;",
    to:   "    if (weapon.unmanned)  return `${weapon.label} has nobody on it`;\n    if (!weapon.armed)    return `${weapon.label} is still charging`;",
  },
  {
    name: '#ammo the click stops passing the reason on',
    file: F('game.js'),
    from: "        const why = CombatManager.playerFire(_selectedWeapon, room);\n        if (why) UI.notify(why, 'warn');",
    to:   "        CombatManager.playerFire(_selectedWeapon, room);",
  },
  {
    name: '#ammo the card stops marking a dry gun',
    file: F('renderer.js'),
    from: "                 : dry        ? `${i+1}· NO AMMO!`",
    to:   "                 : dry        ? `${i+1}· ${w.label.slice(0,14)}`",
  },
  {
    /* The first version of this revert flipped the guard to `true &&`,
       which changes NOTHING: a gun with missileUse 0 fails the inner
       `have < 0` test anyway. A revert that reverts nothing is a revert
       that tests nothing — the script called it a leak and was right.
       This one marks every ammo-eating gun as dry whether or not the
       racks are full, which the section's "the mark goes away when the
       racks are filled" assertion catches. */
    name: '#ammo a loaded gun still reads NO AMMO',
    file: F('renderer.js'),
    from: "        const hold = ship?.cargo;\n        const have = hold ? hold.countOf(a.kind) : (a.kind === 'missiles' ? (run?.missiles ?? 0) : 0);\n        return have < a.use;",
    to:   "        return true;",
  },

  {
    name: '#ammo an unready gun cannot be selected, in silence',
    file: F('game.js'),
    // Re-aimed in update87: an unready gun is aimable; what is refused is what cannot be aimed.
    from: '        if (w && aimWhy) UI.notify(aimWhy, \'warn\');\n',
    to:   '',
  },

  /* ── update60 ─────────────────────────────────────────── */
  /* '#bay a gun finds its module by position again' was here. It only
     added a dead duplicate method — a revert that reverts nothing, which
     the script reported as a leak and was right to. The real revert of
     that fix is the next entry, which removes the roomId lookup. */
  {
    name: '#bay the gun stops remembering its bay at all',
    file: F('ship.js'),
    from: "    if (w.roomId) {\n      const room = this.getRoomById(w.roomId);\n      if (room && room.type === 'weapons') return room;\n    }",
    to:   "    /* positional only */",
  },
  {
    name: '#bay installing a gun does not stamp the bay',
    file: F('ship.js'),
    from: "    w.roomId = this.weaponRooms[slot]?.id ?? null;",
    to:   "    w.roomId = null;",
  },
  {
    name: '#bay power comes from the positional module again',
    file: F('ship.js'),
    from: "      const sys = this.weaponRoomFor(w)?.system ?? null;",
    to:   "      const sys = this.weaponSystemFor(i);",
  },
  {
    name: '#bay manning comes from the positional module again',
    file: F('ship.js'),
    from: "      const room   = this.weaponRoomFor(w);",
    to:   "      const room   = this.weaponRooms[i];",
  },
  {
    name: '#bay the bay is not written to the save',
    file: F('ship.js'),
    from: "roomId: w.roomId ?? null } : null),",
    to:   "} : null),",
  },
  {
    name: '#bay a saved bay is ignored on load',
    file: F('ship.js'),
    from: "        if (wd.roomId && ship.weapons[wd.slot]) ship.weapons[wd.slot].roomId = wd.roomId;",
    to:   "        /* saved bay dropped */",
  },
  /* ── update61 — the world reads karma ─────────────────── */
  {
    name: '#61 ports stop charging a bad name a surcharge',
    file: F('station.js'),
    from: "  fuelCost(amt = 1)       { return Math.round(amt * FUEL_PRICE          * this._priceFactor()); }",
    to:   "  fuelCost(amt = 1)       { return Math.round(amt * FUEL_PRICE); }",
  },
  {
    name: '#61 hull plating stops charging a bad name a surcharge',
    file: F('station.js'),
    from: "  hullRepairCost(hp = 1)  { return Math.round(hp  * REPAIR_PRICES.hull * this._priceFactor()); }",
    to:   "  hullRepairCost(hp = 1)  { return Math.round(hp  * REPAIR_PRICES.hull); }",
  },
  {
    name: '#61 missiles stop charging a bad name a surcharge',
    file: F('station.js'),
    from: "  missileCost(amt = 1)    { return Math.round(amt * MISSILE_PRICE       * this._priceFactor()); }",
    to:   "  missileCost(amt = 1)    { return Math.round(amt * MISSILE_PRICE); }",
  },
  {
    name: '#61 ore stops charging a bad name a surcharge',
    file: F('station.js'),
    from: "    return Math.round(amt * base * (1.1 + this.sector * 0.05) * this._priceFactor());",
    to:   "    return Math.round(amt * base * (1.1 + this.sector * 0.05));",
  },
  {
    name: '#61 the till does its own sum again instead of asking the quote',
    file: F('station.js'),
    from: "    const cost = this.fuelCost(avail);",
    to:   "    const cost = avail * FUEL_PRICE;",
  },
  {
    name: '#61 a discount at the top of the scale (variant A by the back door)',
    file: F('commander.js'),
    from: "  { upTo: 100, surcharge: 0,    label: null },",
    to:   "  { upTo: 100, surcharge: -0.1, label: null },",
  },
  {
    name: '#61 the surcharge band edges slide by one',
    file: F('commander.js'),
    from: "  { upTo: 20,  surcharge: 0.25, label: 'NOTORIOUS' },",
    to:   "  { upTo: 19,  surcharge: 0.25, label: 'NOTORIOUS' },",
  },
  {
    name: '#61 karma outside 0-100 stops clamping',
    file: F('commander.js'),
    from: "    return (typeof k === 'number') ? Utils.clamp(k, 0, 100) : 50;",
    to:   "    return (typeof k === 'number') ? k : 50;",
  },
  {
    name: '#61 EVERY port refuses a shunned commander (strands the run)',
    file: F('commander.js'),
    from: "    return (Math.abs(Math.round(seed)) % 3) === 0;",
    to:   "    return true;",
  },
  {
    name: '#61 refusal rolls fresh each visit instead of sticking to the port',
    file: F('commander.js'),
    from: "  function portRefuses(seed = 0, karma = karmaNow()) {\n    if (karma > KARMA_SHUNNED) return false;",
    to:   "  function portRefuses(seed = 0, karma = karmaNow()) {\n    if (karma > KARMA_SHUNNED) return false;\n    return Math.random() < 0.34;",
  },
  {
    name: '#61 an ordinary commander gets turned away too',
    file: F('commander.js'),
    from: "const KARMA_SHUNNED = 10;",
    to:   "const KARMA_SHUNNED = 60;",
  },
  {
    name: '#61 a shut dock sells fuel anyway',
    file: F('station.js'),
    from: "  buyFuel(amount, run, ship = null) {\n    const closed = this.refusal();\n    if (closed) return { ok: false, message: closed };",
    to:   "  buyFuel(amount, run, ship = null) {",
  },
  {
    name: '#61 a shut dock still welds plating',
    file: F('station.js'),
    from: "  buyHullRepair(hp, ship) {\n    const closed = this.refusal();\n    if (closed) return { ok: false, message: closed };",
    to:   "  buyHullRepair(hp, ship) {",
  },
  {
    name: '#61 the shut dock gives no reason on screen',
    file: F('station.js'),
    from: "    return `${this.name} will not trade with you. `\n         + 'Word of what you did got here first.';",
    to:   "    return ' ';",
  },
  {
    name: '#61 the barracks go back to the flat list price',
    file: F('base.js'),
    from: "    const fee = recruitPrice();\n    if (cc() < fee) return { ok: false, message: `Need ${fee} CC.` };\n    spend(fee);",
    to:   "    if (cc() < PRICE.recruit) return { ok: false, message: `Need ${PRICE.recruit} CC.` };\n    spend(PRICE.recruit);",
  },
  {
    name: '#61 a good name stops buying a cheaper recruit',
    file: F('commander.js'),
    from: "    if (karma >= 80)            return 0.85;",
    to:   "    if (karma >= 80)            return 1;",
  },
  {
    name: '#61 a bad name stops costing more at the hiring hall',
    file: F('commander.js'),
    from: "    if (karma <= KARMA_SHUNNED) return 1.6;\n    if (karma <= 35)            return 1.25;",
    to:   "    if (karma <= KARMA_SHUNNED) return 1;\n    if (karma <= 35)            return 1;",
  },
  {
    name: '#61 the hiring hall stops caring who is asking',
    file: F('station.js'),
    from: "    const cCount = Utils.clamp(ri(0, 3) + interest, 0, 3);",
    to:   "    const cCount = ri(0, 3);",
  },
  {
    name: '#61 a port hand costs the same whoever hires him',
    file: F('station.js'),
    from: "    return Math.round(CREW_PRICE * f);",
    to:   "    return CREW_PRICE;",
  },
  {
    name: '#61 the dossier stops saying what the karma costs',
    file: F('renderer.js'),
    from: "      Commander.karmaWorldLines(karma).forEach(t =>",
    to:   "      [].forEach(t =>",
  },
  {
    name: '#61 the shut-dock warning is shown to everyone',
    file: F('commander.js'),
    from: "    if (karma <= KARMA_SHUNNED) out.push('Some ports will not trade with you at all');",
    to:   "    out.push('Some ports will not trade with you at all');",
  },
  {
    name: '#61 the shop stops showing the karma banner at all',
    /* Only a REAL browser sees this one — the shop is DOM. */
    browser: true,
    file: path.join(ROOT, 'js', 'ui.js'),
    from: "      _stationEl.insertBefore(banner, tabs);",
    to:   "      void banner;",
  },
  {
    name: '#61 a shut dock shows a normal empty shop instead of the reason',
    /* Only a REAL browser sees this one — the shop is DOM. */
    browser: true,
    file: path.join(ROOT, 'js', 'ui.js'),
    from: "      if (refused) { tabs.remove(); document.getElementById('station-content').remove(); return; }",
    to:   "",
  },
  {
    name: '#61 the repair button multiplies its own copy of the price again',
    /* Only a REAL browser sees this one — the shop is DOM. */
    browser: true,
    file: path.join(ROOT, 'js', 'ui.js'),
    from: "                                              : `+${n} HP — ${s.hullRepairCost(n)} CC`,",
    to:   "                                              : `+${n} HP — ${n * REPAIR_PRICES.hull} CC`,",
  },

  /* ── update62 — nobody strikes to a butcher ────────────── */
  {
    name: '#62 the surrender roll goes back to a flat coin, ignoring karma',
    file: F('combat.js'),
    from: "      ? Commander.surrenderChance() : 0.5;",
    to:   "      ? 0.5 : 0.5;",
  },
  {
    name: '#62 a butcher is offered surrenders again',
    file: F('commander.js'),
    from: "    if (karma <= KARMA_SHUNNED) return 0;\n    if (karma <= 35)            return 0.25;",
    to:   "    if (karma <= KARMA_SHUNNED) return 0.5;\n    if (karma <= 35)            return 0.5;",
  },
  {
    name: '#62 a good name stops buying more surrenders',
    file: F('commander.js'),
    from: "    if (karma >= 80)            return 0.75;",
    to:   "    if (karma >= 80)            return 0.5;",
  },
  {
    name: '#62 the no-quarter refusal is silent again',
    file: F('combat.js'),
    from: "          UI.notify('They will not surrender to you. They know what you do to prisoners.', 'alert');",
    to:   "          void 0;",
  },
  {
    name: '#62 the hull roll fires every frame instead of once',
    file: F('combat.js'),
    from: "      this._hullRolled = true;\n      if (this.noQuarter()) {",
    to:   "      if (this.noQuarter()) {",
  },
  {
    name: '#62 the beaten hull stops offering anything at all',
    file: F('combat.js'),
    from: "      } else if (Math.random() < this.surrenderOdds()) {\n        this._raiseSurrender();",
    to:   "      } else if (false) {\n        this._raiseSurrender();",
  },
  {
    name: '#62 a cleared deck is a hulk again, commander or not',
    file: F('game.js'),
    from: "      _event = (foeCap && !noQuarter) ? {",
    to:   "      _event = (false) ? {",
  },
  {
    name: '#62 sparing their commander is free — no karma for it',
    file: F('game.js'),
    from: "        { label: 'Let him go — board it and cast off',\n          result: { searchDerelict: true,\n                    karma: Commander?.KARMA?.HELP_AT_COST ?? 5 } },",
    to:   "        { label: 'Let him go — board it and cast off',\n          result: { searchDerelict: true } },",
  },
  {
    name: '#62 finishing a struck commander is not a helpless kill',
    file: F('game.js'),
    from: "          result: { destroyDerelict: true, takeBody: true,\n                    karma: Commander?.KARMA?.KILL_HELPLESS ?? -10 } });",
    to:   "          result: { destroyDerelict: true, takeBody: true } });",
  },
  {
    name: '#62 a butcher gets the surrender event anyway',
    file: F('game.js'),
    from: "      const noQuarter = CombatManager.noQuarter?.() ?? false;",
    to:   "      const noQuarter = false;",
  },
  {
    name: '#62 the commander who would rather burn says nothing',
    file: F('game.js'),
    from: "        UI.notify(`${foeCap.name} would rather burn with his ship than be your prisoner.`, 'alert');",
    to:   "        void 0;",
  },
  {
    name: '#62 the struck commander is nameless in the text',
    file: F('game.js'),
    from: "        text: `Nobody aboard is left standing. ${foeCap.name} puts down his sidearm `",
    to:   "        text: `Nobody aboard is left standing. Somebody puts down his sidearm `",
  },
  {
    name: '#62 the dossier stops mentioning surrenders',
    file: F('commander.js'),
    from: "    out.push(sc === 0 ? 'Beaten crews fight you to the last man — they never surrender'",
    to:   "    if (false) out.push(sc === 0 ? 'Beaten crews fight you to the last man — they never surrender'",
  },

  /* ── update63 — the brig ───────────────────────────────── */
  {
    name: '#63 cells stop following the module level',
    file: F('ship.js'),
    // Re-aimed in update77: capacity counts POWERED levels now.
    from: "    return Math.max(0, Math.min(b.workingLevels, b.effectivePower()));",
    to:   "    return 1;",
  },
  {
    name: '#63 the brig overfills instead of refusing',
    file: F('ship.js'),
    from: "    if (!rec || this.freeCells() <= 0) return false;",
    to:   "    if (!rec) return false;",
  },
  {
    name: '#63 a hull with no carbonite bay can still hold men',
    file: F('ship.js'),
    from: "    const b = this.getSystem('carbonite');\n    if (!b) return 0;",
    to:   "    const b = this.getSystem('carbonite');\n    if (!b) return 3;",
  },
  {
    name: '#63 an unpowered carbonite bay holds them anyway',
    file: F('ship.js'),
    // Re-aimed in update77: the yes-or-no became a count of slabs.
    from: "    const slabs = Math.min(this.prisoners.length, this.carboniteCapacity());",
    to:   "    const slabs = this.prisoners.length;",
  },
  {
    name: '#63 restoring power no longer resets the lock',
    file: F('ship.js'),
    from: "    this.prisoners.slice(0, slabs).forEach(p => { p.escapeT = 0; p.warned = false; });",
    to:   "    ;",
  },
  {
    name: '#63 nobody is warned before a prisoner walks',
    file: F('ship.js'),
    from: "          UI.notify(`${p.name} is working the cell door — get the carbonite bay powered!`, 'alert');",
    to:   "          void 0;",
  },
  {
    name: '#63 the warning repeats every frame',
    file: F('ship.js'),
    from: "        p.warned = true;",
    to:   "        p.warned = false;",
  },
  {
    name: '#63 an escaped prisoner leaves in silence',
    file: F('ship.js'),
    from: "      UI.notify(poster",
    to:   "      if (false) UI.notify(poster",
  },
  {
    name: '#63 the escape clock never runs out',
    file: F('ship.js'),
    from: "      if (p.escapeT >= Ship.ESCAPE_SECONDS) gone.push(p);",
    to:   "      if (false) gone.push(p);",
  },
  {
    name: '#63 the cells are not written to the save',
    file: F('ship.js'),
    from: "      prisoners: this.prisoners.map(p => ({ ...p })),",
    to:   "      prisoners: [],",
  },
  {
    name: '#63 a loaded prisoner comes back mid-escape',
    file: F('ship.js'),
    from: "      id: p.id, name: p.name, bounty: p.bounty ?? 0, escapeT: 0, warned: false,",
    to:   "      id: p.id, name: p.name, bounty: p.bounty ?? 0, escapeT: p.escapeT, warned: false,",
  },
  {
    name: '#63 the loaded prisoner loses his price',
    file: F('ship.js'),
    from: "    ship.prisoners = (data.prisoners ?? []).map(p => ({",
    to:   "    ship.prisoners = (data.prisoners ?? []).map(p => ({ ...p, bounty: 0 })).map(p => ({",
  },
  {
    name: '#63 the cell door is offered with nowhere to put him',
    file: F('game.js'),
    from: "      if (foeCap && foeCap.wantedId && !noQuarter && cells > 0) {",
    to:   "      if (foeCap && foeCap.wantedId && !noQuarter) {",
  },
  {
    name: '#63 the body price stops being half the living one',
    file: F('game.js'),
    from: "        { label: `Finish him off — his body is worth ${Math.round(bounty / 2)} CC`,",
    to:   "        { label: `Finish him off — his body is worth 30 CC`,",
  },
  {
    name: '#63 accepting no longer locks him up',
    file: F('game.js'),
    from: "      if (result.capture) _lockUpCommander();",
    to:   "      void 0;",
  },
  {
    name: '#63 the prisoner is locked up under the wrong price',
    file: F('game.js'),
    from: "      id: cap.id, name: cap.name, bounty: _commanderBounty(cap),",
    to:   "      id: cap.id, name: cap.name, bounty: 30,",
  },
  {
    name: '#63 the bag stops carrying the man\'s own price',
    file: F('cargo.js'),
    from: "    if (this.def.tag === 'body' && this.meta && this.meta.bounty > 0) v = this.meta.bounty;",
    to:   "    void 0;",
  },
  {
    name: '#63 a bagged body shrinks to one cell',
    file: F('cargo.js'),
    from: "    w: 2, h: 1, value: 60, col: '#8a94a8', kind: 'trade', tag: 'body',",
    to:   "    w: 1, h: 1, value: 60, col: '#8a94a8', kind: 'trade', tag: 'body',",
  },
  {
    name: '#63 the dock stops paying for prisoners',
    file: F('base.js'),
    from: "        if (paid > 0) earn(paid);\n        report.bounty += paid;\n        report.prisoners++;",
    to:   "        report.prisoners++;",
  },
  {
    name: '#63 the handed-over prisoner stays on the hull (paid twice)',
    file: F('base.js'),
    from: "      d.prisoners = [];",
    to:   "      void 0;",
  },
  {
    name: '#63 the claimed body stays in the hold (paid twice)',
    file: F('base.js'),
    from: "        hold.items = hold.items.filter(it => !bags.includes(it));",
    to:   "        void 0;",
  },
  {
    name: '#63 the dock stops paying for bodies',
    file: F('base.js'),
    from: "          const paid = Math.max(0, Math.round(it.meta?.bounty ?? CARGO_ITEMS[it.defKey]?.value ?? 0));",
    to:   "          const paid = 0;",
  },

  /* ── update64 — the wanted list ────────────────────────── */
  {
    name: '#64 an old save gets no wanted list at all',
    file: F('save.js'),
    from: "    _data.wanted = [makeWanted(1)];",
    to:   "    _data.wanted = [];",
  },
  {
    name: '#64 an emptied board refills itself on every load',
    file: F('save.js'),
    from: "    if (Array.isArray(_data.wanted)) return;",
    to:   "    if (Array.isArray(_data.wanted) && _data.wanted.length) return;",
  },
  {
    name: '#64 the board grows without a ceiling',
    file: F('save.js'),
    from: "    if (_data.wanted.length >= WANTED_MAX) return null;\n    const w = makeWanted(sector);",
    to:   "    if (false) return null;\n    const w = makeWanted(sector);",
  },
  {
    name: '#64 two posters can carry the same name',
    file: F('save.js'),
    from: "    const pool  = PIRATE_NAMES.filter(n => !taken.has(n));",
    to:   "    const pool  = PIRATE_NAMES;",
  },
  {
    name: '#64 the bounty stops following the level',
    file: F('save.js'),
    from: "  function wantedBounty(level) { return Math.round(80 + level * 20); }",
    to:   "  function wantedBounty(level) { return 100; }",
  },
  {
    name: '#64 wantedById hands back a COPY, so the base and the fight drift',
    file: F('save.js'),
    from: "  function wantedById(id) { return (_data?.wanted ?? []).find(w => w.id === id) || null; }",
    to:   "  function wantedById(id) { const w = (_data?.wanted ?? []).find(x => x.id === id); return w ? { ...w } : null; }",
  },
  {
    name: '#64 a delivered man stays on the board',
    file: F('save.js'),
    from: "    _data.wanted.splice(i, 1);",
    to:   "    void 0;",
  },
  {
    name: '#64 a sighting no longer records where',
    file: F('save.js'),
    from: "    w.state  = 'sighted';",
    to:   "    void 0;",
  },
  {
    name: '#64 no fight ever seats a wanted man',
    file: F('game.js'),
    from: "      if (boss && !BossManager.isActive) boss = _seatWantedPirate(boss, sec);",
    to:   "      void 0;",
  },
  {
    name: '#64 the seated pirate is a COPY, not the poster',
    file: F('game.js'),
    from: "    cap.wantedId = w.id;",
    to:   "    cap.wantedId = null;",
  },
  {
    name: '#64 meeting him does not mark the board',
    file: F('game.js'),
    from: "    Save.markSighted(w.id);",
    to:   "    void 0;",
  },
  {
    name: '#64 the fight prices him off his rank, not off the poster',
    file: F('game.js'),
    from: "    if (cap.bounty > 0) return Math.round(cap.bounty);",
    to:   "    void 0;",
  },
  {
    name: '#64 a delivered man is hunted again',
    file: F('game.js'),
    from: "    return (id && typeof Save !== 'undefined' && Save.wantedById)\n      ? Save.wantedById(id) : null;",
    to:   "    return (id && typeof Save !== 'undefined' && Save.wantedById)\n      ? (Save.wantedById(id) || { id, name: 'Ghost', bounty: 1, escapes: 0, level: 1 }) : null;",
  },
  {
    name: '#64 the prisoner forgets which poster he came off',
    file: F('game.js'),
    from: "      wantedId: cap.wantedId ?? null,\n    });",
    to:   "      wantedId: null,\n    });",
  },
  {
    name: '#64 the body bag forgets which poster it came off',
    file: F('game.js'),
    from: "        wantedId: cap.wantedId ?? null });",
    to:   "        wantedId: null });",
  },
  {
    name: '#64 the cell record drops the poster id',
    file: F('ship.js'),
    from: "      wantedId: rec.wantedId ?? null,",
    to:   "      wantedId: null,",
  },
  {
    name: '#64 handing a prisoner over does not close the case',
    file: F('base.js'),
    from: "        if (p.wantedId) { Save.deliverWanted(p.wantedId, paid); report.wanted++; }",
    to:   "        void 0;",
  },
  {
    name: '#64 delivering a body does not close the case',
    file: F('base.js'),
    from: "          if (it.meta?.wantedId) {\n            Save.deliverWanted(it.meta.wantedId, paid); report.wanted++;\n          }",
    to:   "          void 0;",
  },
  {
    name: '#64 the WANTED tab is gone from the base',
    file: F('basescreen.js'),
    // update127: the tabs live in TAB_GROUPS (TABS was dead since update115)
    from: "['MEMORIAL', 'MEMORIAL'], ['WANTED', 'WANTED'], ['GATE', 'GATE']]",
    to:   "['MEMORIAL', 'MEMORIAL'], ['GATE', 'GATE']]",
  },
  {
    name: '#64 the base loses its wanted board',
    file: F('basescreen.js'),
    from: "    if (_tab === 'WANTED')   _drawWanted(ctx, px, py, pw, ph);",
    to:   "    void 0;",
  },
  {
    name: '#64 the board caches the list instead of reading it',
    file: F('basescreen.js'),
    from: "    const list = (typeof Save !== 'undefined' && Save.wanted) ? Save.wanted() : [];",
    to:   "    const list = (_wantedCache = _wantedCache || ((typeof Save !== 'undefined' && Save.wanted) ? Save.wanted() : []));",
  },
  {
    name: '#64 an empty board draws nothing instead of explaining itself',
    file: F('basescreen.js'),
    from: "      ctx.fillText('The board is empty. Finish a contract and the yard will find somebody.',",
    to:   "      ctx.fillText('',",
  },
  {
    name: '#64 the board stops showing the price for a body',
    file: F('basescreen.js'),
    from: "      ctx.fillText(`${Math.round(w.bounty / 2)} CC for the body`, x + cw / 2, y + chH - 13);",
    to:   "      void 0;",
  },
  {
    name: '#64 the board hides whether he has been sighted',
    file: F('basescreen.js'),
    from: "      ctx.fillText(_clip(ctx, sighted ? (where ? `last seen: ${where}` : 'sighted') : 'no sighting yet', cw - 16), x + cw / 2, fy + S + 66);",
    to:   "      ctx.fillText('no sighting yet', x + cw / 2, fy + S + 66);",
  },
  {
    name: '#64 the carbonite bay goes back to being hard to find',
    file: F('station.js'),
    from: "        ...(r() < 0.60 ? [{ type: 'carbonite',       cost: 80 + this.sector * 10, sold: false }] : []),",
    to:   "        ...(r() < 0.05 ? [{ type: 'carbonite',       cost: 80 + this.sector * 10, sold: false }] : []),",
  },

  /* ── update65 — bodies: the player decides ─────────────── */
  {
    name: '#65 an open hatch throws the dead out again, unasked',
    file: F('ship.js'),
    // Re-aimed in update75: the order is called 'eject' now.
    from: "            if (b.dead) return b.bodyOrder === 'eject' && (this.isPlayer || c._rescueId === b.id);",
    to:   "            if (b.dead) return this.isPlayer || c._rescueId === b.id;",
  },
  {
    name: '#65 the corpse dispatch ignores the order again',
    file: F('ship.js'),
    from: "        if (this.isPlayer && body.dead && body.bodyOrder === 'eject' && !body.carriedBy &&",
    to:   "        if (this.isPlayer && body.dead && body.decaying && !body.carriedBy &&",
  },
  {
    name: '#65 the wounded stop being collected on their own',
    file: F('ship.js'),
    from: "            // wounded: pointless to carry if there's no medbay at all\n            return !!medRoom;",
    to:   "            return b.bodyOrder === 'treat' && !!medRoom;",
  },
  {
    name: '#65 TREAT is offered for a corpse',
    file: F('ship.js'),
    // Re-aimed in update78: MEDKIT added a second `if (body.dead)`
    // branch, so the bare line matched twice. The TREAT branch is
    // named by the line that follows it.
    from: "      if (body.dead) return 'he is dead';\n      const med = this.getSystem('medbay');",
    to:   "      if (false) return 'he is dead';\n      const med = this.getSystem('medbay');",
  },
  {
    name: '#65 TREAT is offered with no medbay aboard',
    file: F('ship.js'),
    from: "      if (!med) return 'no medbay aboard';",
    to:   "      if (false) return 'no medbay aboard';",
  },
  {
    name: '#65 VENT is offered on a hull with no airlock at all',
    file: F('ship.js'),
    from: "      if (!this.doors.some(d => d.isAirlock)) return 'no airlock on this hull';",
    to:   "      if (false) return 'no airlock on this hull';",
  },
  {
    name: '#65 BAG happens with nobody free to do it',
    file: F('ship.js'),
    from: "      if (!hands) return 'nobody free to do it';",
    to:   "      if (false) return 'nobody free to do it';",
  },
  {
    name: '#65 BAG is accepted into a full hold',
    file: F('ship.js'),
    from: "      if (!probe.add(Ship.bagKeyFor(body))) return 'no room in the hold';",
    to:   "      if (false) return 'no room in the hold';",
  },
  {
    name: '#65 the order stops giving the menu\'s reason',
    file: F('ship.js'),
    from: "    if (why) return { ok: false, message: `Cannot ${act}: ${why}.` };",
    to:   "    if (why) return { ok: false, message: 'No.' };",
  },
  {
    name: '#65 a cat needs two cells like a man',
    file: F('ship.js'),
    from: "  static bagKeyFor(body) { return body && body.isPet ? 'pet_bag' : 'body_bag'; }",
    to:   "  static bagKeyFor(body) { return 'body_bag'; }",
  },
  {
    name: '#65 the bagged man is left lying on the deck',
    file: F('ship.js'),
    from: "    body.bagged = true;\n    this.crew = this.crew.filter(c => c !== body);",
    to:   "    body.bagged = true;\n    void 0;",
  },
  {
    name: '#65 the bag forgets whose it is',
    file: F('ship.js'),
    from: "      crewBody: true,",
    to:   "      crewBody: false,",
  },
  {
    name: '#65 venting your own dead is free',
    file: F('ship.js'),
    from: "        Commander.shift(Commander.active(), Ship.EJECT_KARMA);",
    to:   "        void 0;",
  },
  {
    name: '#65 a man who walked out on his own costs karma too',
    file: F('ship.js'),
    from: "      if (this.isPlayer && c.isPlayer && c.dead && c.bodyOrder === 'eject' &&",
    to:   "      if (this.isPlayer && c.isPlayer && c.dead &&",
  },
  {
    name: '#65 a crew bag is priced like merchandise',
    file: F('cargo.js'),
    from: "    if (this.meta && this.meta.crewBody) return 0;",
    to:   "    void 0;",
  },
  {
    name: '#65 the pet bag grows to two cells',
    file: F('cargo.js'),
    from: "    w: 1, h: 1, value: 30, col: '#8a94a8', kind: 'trade', tag: 'body',",
    to:   "    w: 2, h: 1, value: 30, col: '#8a94a8', kind: 'trade', tag: 'body',",
  },
  {
    name: '#65 the dock stops burying your own and sells them instead',
    file: F('base.js'),
    from: "          if (it.meta?.crewBody) {",
    to:   "          if (false) {",
  },
  {
    name: '#65 the burial pays no karma',
    file: F('base.js'),
    from: "              Commander.shift(Commander.active(), Ship.BURIAL_KARMA);",
    to:   "              void 0;",
  },
  {
    name: '#65 the memorial is never told he came home',
    file: F('base.js'),
    from: "            Save.markBuried?.(it.meta.crewId, it.meta.name);",
    to:   "            void 0;",
  },
  {
    name: '#65 the mark matches nobody at all',
    file: F('save.js'),
    from: "    const rec = list.find(g => g && ((id && g.id === id) || (!id && name && g.name === name)))\n             || list.find(g => g && name && g.name === name);",
    to:   "    const rec = null;",
  },
  {
    name: '#65 a man can be buried twice',
    file: F('save.js'),
    from: "    if (!rec || rec.buried) return false;",
    to:   "    if (!rec) return false;",
  },
  {
    name: '#65 the memorial stops saying who came home',
    file: F('basescreen.js'),
    from: "    ctx.fillText('brought home and buried', x + 12, y + 80);",
    to:   "    ;",
  },
  {
    name: '#65 the menu rows overlap each other',
    file: F('renderer.js'),
    from: "        y: py + BODY_MENU_PAD + i * BODY_MENU_ROW,",
    to:   "        y: py + BODY_MENU_PAD + i * 4,",
  },
  {
    name: '#65 the menu opens off the edge of the screen',
    file: F('renderer.js'),
    from: "    const px = Utils.clamp(x - BODY_MENU_W / 2, 4, _W - BODY_MENU_W - 4);\n    const py = Utils.clamp(y + BODY_MENU_DROP, 4, _H - h - 4);",
    to:   "    const px = x - BODY_MENU_W / 2;\n    const py = y + BODY_MENU_DROP;",
  },
  {
    name: '#65 the drawing keeps its own copy of the row geometry',
    file: F('renderer.js'),
    from: "      ctx.fillText(LABEL[it.act], it.x + 4, it.y + 10);",
    to:   "      ctx.fillText(LABEL[it.act], it.x + 4, it.y + 40);",
  },

  /* ── update66 — the hunt on the map, and four rations ──── */
  {
    name: '#66 no sector ever carries a poster',
    file: F('map.js'),
    from: "    this._seatWanted();",
    to:   "    void 0;",
  },
  {
    name: '#66 EVERY sector carries one',
    file: F('map.js'),
    from: "    if (this._rng() >= SectorMap.WANTED_ON_MAP) return;",
    to:   "    if (false) return;",
  },
  {
    name: '#66 the poster moves on every reload (loose Math.random)',
    file: F('map.js'),
    from: "    const node = this._rngPick(fights);",
    to:   "    const node = Utils.pick(fights);",
  },
  {
    name: '#66 the poster can land on the boss or the first hop',
    file: F('map.js'),
    from: "      n.type === 'combat' && !n.isBoss && !n.isExit && n.col > 1);",
    to:   "      n.type === 'combat');",
  },
  {
    name: '#66 the node keeps its own copy of the pirate',
    file: F('map.js'),
    from: "    return Save.wantedById(this.wantedId);",
    to:   "    return { name: 'Ghost', bounty: 1 };",
  },
  {
    name: '#66 a wanted node looks like every other fight',
    file: F('map.js'),
    from: "  get label() { return this.wanted ? this.wanted.name : this.def.label; }",
    to:   "  get label() { return this.def.label; }",
  },
  {
    name: '#66 the wanted node loses its marker',
    file: F('map.js'),
    from: "  get icon()  { return this.wanted ? '☠' : this.def.icon; }",
    to:   "  get icon()  { return this.def.icon; }",
  },
  {
    name: '#66 the wanted node loses its colour',
    file: F('map.js'),
    from: "  get color() { return this.wanted ? '#ff9a4d' : this.def.color; }",
    to:   "  get color() { return this.def.color; }",
  },
  {
    name: '#66 the fight rolls for a wanted man again instead of reading the node',
    file: F('game.js'),
    from: "    const w = _wantedOnThisNode();\n    if (!w) return cap;",
    to:   "    const w = Math.random() < 0.35 ? Utils.pick(Save.wanted()) : null;\n    if (!w) return cap;",
  },
  {
    name: '#66 his node may still roll no commander at all',
    file: F('game.js'),
    from: "      const chance = (BossManager.isActive || posted)\n        ? 1 : Math.min(0.55, 0.12 + sec * 0.12);",
    to:   "      const chance = BossManager.isActive ? 1 : Math.min(0.55, 0.12 + sec * 0.12);",
  },
  {
    name: '#66 the sighting stops recording how deep',
    file: F('save.js'),
    from: "    w.sector = _data?.run?.sector ?? w.sector ?? null;",
    to:   "    void 0;",
  },
  {
    name: '#66 the standard ration quietly changes value',
    file: F('cargo.js'),
    from: "    stackMax: 5, unitValue: 8, hunger: 50, meat: true,",
    to:   "    stackMax: 5, unitValue: 8, hunger: 25, meat: true,",
  },
  {
    name: '#66 a field meal shrinks to one cell',
    file: F('cargo.js'),
    from: "    w: 2, h: 1, col: '#c08f5a', kind: 'food', tag: 'food',",
    to:   "    w: 1, h: 1, col: '#c08f5a', kind: 'food', tag: 'food',",
  },
  {
    name: '#66 greens are meat after all',
    file: F('cargo.js'),
    from: "    stackMax: 5, unitValue: 12, hunger: 50, meat: false,",
    to:   "    stackMax: 5, unitValue: 12, hunger: 50, meat: true,",
  },
  {
    name: '#66 every meal feeds the same again (the old flat table)',
    file: F('ship.js'),
    from: "                        : { hunger: meal.def?.hunger ?? 50, hp: 4 };",
    to:   "                        : { hunger: 50, hp: 4 };",
  },
  {
    name: '#66 the cat eats the greens',
    file: F('ship.js'),
    from: "    if (who.isPet && item.def.meat === false) return false;",
    to:   "    if (false) return false;",
  },
  {
    name: '#66 a hungry mouth helps itself to what it will not touch',
    file: F('ship.js'),
    /* Re-aimed in update81: `_startMeal` stopped choosing its own meal
       and the willEat filter moved into `mealFor`, the one chooser.
       The rule it guards is unchanged — nobody is served something he
       would not have taken on his own. */
    from: "      it && it.def?.tag === 'food' && !it.damaged && this.willEat(who, it));",
    to:   "      it && it.def?.tag === 'food' && !it.damaged);",
  },
  {
    name: '#66 FEED is offered to a man who is not hungry',
    file: F('ship.js'),
    from: "    if ((who.hunger ?? 100) >= 100) return `${who.name} is not hungry`;",
    to:   "    if (false) return `${who.name} is not hungry`;",
  },
  {
    name: '#66 FEED is offered to a man mid-meal',
    file: F('ship.js'),
    // Re-aimed in update78: `_eatT` was folded into the ONE busy
    // clock, so the question is now "are his hands full" and it covers
    // bandaging and medkits as well as the meal.
    from: "    if (who.busy) return `${who.name} has his hands full`;",
    to:   "    if (false) return `${who.name} has his hands full`;",
  },
  {
    name: '#66 the order stops giving the menu\'s reason for FEED',
    file: F('ship.js'),
    from: "    const why = this.feedRefusal(who, item);\n    if (why) return { ok: false, message: why };",
    to:   "    const why = this.feedRefusal(who, item);\n    if (why) return { ok: false, message: 'No.' };",
  },
  {
    name: '#66 a port can stock nothing to eat at all',
    file: F('station.js'),
    from: "        if (!Object.keys(out).length) out.ration_pack = ri(2, 6 + s);",
    to:   "        void 0;",
  },
  {
    name: '#66 every port stocks all four kinds',
    file: F('station.js'),
    from: "        KINDS.forEach(k => { if (r() < 0.55) out[k] = ri(2, 8 + s); });",
    to:   "        KINDS.forEach(k => { out[k] = ri(2, 8 + s); });",
  },
  {
    name: '#66 the meal counter charges before checking the hold',
    file: F('station.js'),
    from: "    avail -= probe.addStack(key, avail);\n    if (avail <= 0) return { ok: false, message: 'No room in the hold.' };",
    to:   "    if (false) return { ok: false, message: 'No room in the hold.' };",
  },
  {
    name: '#66 the meal counter sells anything at all',
    file: F('station.js'),
    from: "    if (!def || def.tag !== 'food') return { ok: false, message: 'Not food.' };",
    to:   "    if (!def) return { ok: false, message: 'Not food.' };",
  },

  /* ── update67 — debts paid ─────────────────────────────── */
  {
    name: '#67 the hangar reads the LAYOUT instead of the hull',
    file: F('basescreen.js'),
    from: "  function _entryLevels(entry) {\n    const sh = _entryShip(entry);",
    to:   "  function _entryLevels(entry) {\n    const sh = new Ship(entry.key, true, 0, 0);",
  },
  {
    name: '#67 the module strip stops drawing the modules',
    file: F('basescreen.js'),
    from: "    const mods = all.filter(m => m.type !== 'reactor');",
    to:   "    const mods = all.filter(m => m.type !== 'reactor').slice(0, 3);",
  },
  {
    name: '#67 an installed module is dropped from the save',
    file: F('ship.js'),
    from: "      extraModules: [...(this._extraModules ?? [])],",
    to:   "      extraModules: [],",
  },
  {
    name: '#67 prisoners stop eating',
    file: F('ship.js'),
    from: "        if ((meal.qty ?? 0) > 1) meal.qty--; else this.cargo.remove(meal);\n        out.fed++;",
    to:   "        out.fed++;",
  },
  {
    name: '#67 a starving prisoner just stays in his cell',
    file: F('ship.js'),
    from: "      this.prisoners.splice(this.prisoners.indexOf(p), 1);\n      out.starved.push(p.name);",
    to:   "      out.starved.push(p.name);",
  },
  {
    name: '#67 a starved prisoner leaves no body',
    file: F('ship.js'),
    from: "      const bag = this.cargo?.add?.('body_bag', {\n        name: p.name, bounty: Math.round((p.bounty ?? 0) / 2),",
    to:   "      const bag = null && this.cargo?.add?.('body_bag', {\n        name: p.name, bounty: Math.round((p.bounty ?? 0) / 2),",
  },
  {
    name: '#67 a starved prisoner is worth full price as a body',
    file: F('ship.js'),
    from: "        name: p.name, bounty: Math.round((p.bounty ?? 0) / 2),\n        wantedId: p.wantedId ?? null,",
    to:   "        name: p.name, bounty: (p.bounty ?? 0),\n        wantedId: p.wantedId ?? null,",
  },
  {
    name: '#67 the jump stops feeding the brig',
    file: F('game.js'),
    from: "    _playerShip?.feedPrisoners?.();",
    to:   "    void 0;",
  },
  {
    name: '#67 an escaper never goes back on the board',
    file: F('ship.js'),
    from: "      poster = Save.reWanted({ wantedId: c.wantedId ?? null, name: c.name,",
    to:   "      poster = null; void ({ wantedId: c.wantedId ?? null, name: c.name,",
  },
  {
    name: '#67 an escaper goes back at the same price',
    file: F('save.js'),
    from: "  const ESCAPE_BOUNTY_RAISE = 1.5;",
    to:   "  const ESCAPE_BOUNTY_RAISE = 1;",
  },
  {
    name: '#67 an escaper who was already listed gets a SECOND poster',
    file: F('save.js'),
    from: "    const known = _data.wanted.find(w => w.id === rec.wantedId);",
    to:   "    const known = null;",
  },
  {
    name: '#67 an escaper comes back still marked as sighted',
    file: F('save.js'),
    from: "      known.state  = 'wanted';",
    to:   "      void 0;",
  },
  {
    name: '#67 the board grows past its ceiling for escapers',
    file: F('save.js'),
    from: "    if (_data.wanted.length >= WANTED_MAX) return null;\n    const w = {",
    to:   "    if (false) return null;\n    const w = {",
  },
  {
    name: '#67 an ENEMY brig losing a man puts him on our board',
    file: F('ship.js'),
    from: "    if (this.isPlayer && typeof Save !== 'undefined' && Save.reWanted) {",
    to:   "    if (typeof Save !== 'undefined' && Save.reWanted) {",
  },
  {
    name: '#67 an escaper comes back at the same rank',
    file: F('save.js'),
    from: "    w.level   = Utils.clamp((w.level ?? 5) + ESCAPE_LEVEL_GAIN, 1, 24);",
    to:   "    w.level   = Utils.clamp((w.level ?? 5), 1, 24);",
  },
  {
    name: '#67 the escape counter latches instead of counting',
    file: F('save.js'),
    from: "    w.escapes = (w.escapes ?? 0) + 1;",
    to:   "    w.escapes = 1;",
  },
  {
    name: '#67 a re-listed man is only dearer, never harder',
    file: F('save.js'),
    from: "      _harden(known);\n      known.bounty = raise(known.bounty);",
    to:   "      known.bounty = raise(known.bounty);",
  },
  {
    name: '#67 the fight ignores the rank the board promised',
    file: F('game.js'),
    from: "    if (w.level > (cap.level ?? 1) && Commander.rollEnemy) {",
    to:   "    if (false) {",
  },
  {
    name: '#67 an escapee gets no better hull than anybody else',
    file: F('game.js'),
    from: "    if (escapee && escapee.escapes > 0) difficulty = 'hard';",
    to:   "    void 0;",
  },

  /* ── update68 — the player's bug list ──────────────────── */
  {
    name: '#68 the hangar preview cache forgets what the hull IS',
    file: F('basescreen.js'),
    from: "    const sig = entry.data ? JSON.stringify(entry.data) : 'fresh';\n    const key = `${_shipIdx}|${entry.key}|${sig}|",
    to:   "    const sig = entry.data ? JSON.stringify(entry.data) : 'fresh';\n    void sig;\n    const key = `${_shipIdx}|${entry.key}|",
  },
  {
    name: '#68 body bags are unloaded onto the warehouse shelf again',
    file: F('game.js'),
    from: "        if (yardRefuses(it)) continue;",
    to:   "        if (false) continue;",
  },
  {
    name: '#68 the commander leaves the chair before the burial pays him',
    file: F('game.js'),
    // Re-aimed in update98: the dock also refills his knowledge.
    from: "    if (_commander) {\n      _commander.away = false;\n      Commander?.refillKnowledge?.(_commander, 1);     // home: full (update98)\n      Base.saveCommander?.(_commander);\n    }\n    Commander?.setActive?.(null);\n\n    const bits = [];",
    to:   "    const bits = [];",
  },
  {
    name: '#68 the sorting screen offers your own dead for sale',
    file: F('game.js'),
    from: "    const holdHasGoods = !!hold?.items?.some(it => !yardRefuses(it));",
    to:   "    const holdHasGoods = !!hold?.items?.length;",
  },
  {
    name: '#68 VENT needs a hatch the player opened first',
    file: F('ship.js'),
    from: "      if (!this.doors.some(d => d.isAirlock)) return 'no airlock on this hull';",
    to:   "      if (!this.hasOpenAirlock()) return 'every airlock is shut';",
  },
  {
    name: '#68 the bearer walks to a shut hatch and stands there',
    file: F('ship.js'),
    from: "        const air = this.doors.filter(d => d.isAirlock)",
    to:   "        const air = this.doors.filter(d => d.isAirlock && d.mode === 'open')",
  },
  {
    name: '#68 the burial leaves the airlock hanging open',
    file: F('ship.js'),
    from: "              if (c._ventOpened === air.id) { air.mode = 'closed'; air.open = false; }",
    to:   "              void 0;",
  },
  {
    name: '#68 the order names a man and never sends him',
    file: F('ship.js'),
    from: "      pick.moveToOnShip?.(this, body.x, body.y);\n    }\n    return { ok: true, message: act === 'treat'",
    to:   "      void 0;\n    }\n    return { ok: true, message: act === 'treat'",
  },
  {
    name: '#68 BAG demands somebody already standing over him',
    file: F('ship.js'),
    from: "        c && c.alive && c.isPlayer === this.isPlayer && !c.carrying);\n      if (!hands) return 'nobody free to do it';",
    to:   "        c && c.alive && c.isPlayer === this.isPlayer && c.roomId === body.roomId);\n      if (!hands) return 'nobody free to do it';",
  },
  {
    name: '#68 a man sent to bag a body never finishes the job',
    file: F('ship.js'),
    from: "    this.bagArrivals();",
    to:   "    void 0;",
  },
  {
    name: '#68 the menu opens with nobody selected',
    file: F('game.js'),
    from: "      const sel = UI.getSelectedCrewAll();\n      const body = sel.length ? _bodyUnderCursor(mx, my) : null;",
    to:   "      const body = _bodyUnderCursor(mx, my);",
  },
  {
    name: '#68 a greyed row swallows the click in silence',
    file: F('game.js'),
    from: "        const why = _playerShip.menuRefusal(body, hit.act);\n        if (why) {",
    to:   "        const why = null;\n        if (why) {",
  },
  {
    name: '#68 a body is drawn on top of the man standing over it',
    file: F('crew.js'),
    from: "  static get BODY_DROP() { return 10; }",
    to:   "  static get BODY_DROP() { return 0; }",
  },
  {
    name: '#68 the body hit test forgets the offset the drawing uses',
    file: F('game.js'),
    from: "      const dy = (c.dead || c.down) ? CrewMember.BODY_DROP : 0;",
    to:   "      const dy = 0;",
  },
  {
    name: '#68 a won fight can still leave you stranded',
    file: F('game.js'),
    from: "      if (_fuelAboard() <= 0) {\n        const r = _addFuel(1);",
    to:   "      if (false) {\n        const r = _addFuel(1);",
  },
  {
    name: '#68 the map jump asks only about fuel again',
    file: F('game.js'),
    from: "      const why = _jumpRefusal();\n      if (why) {",
    to:   "      const why = _fuelAboard() <= 0 ? 'no fuel' : null;\n      if (why) {",
  },
  {
    name: '#68 nobody has to be at the helm',
    file: F('game.js'),
    from: "    if (!at.length) return 'Nobody at the helm — put a hand in the cockpit.';",
    to:   "    if (false) return 'Nobody at the helm — put a hand in the cockpit.';",
  },
  {
    name: '#68 a dead cockpit no longer stops a jump',
    file: F('game.js'),
    from: "    if (!pil || pil.effectivePower() <= 0) return 'Cockpit offline — cannot jump!';",
    to:   "    if (false) return 'Cockpit offline — cannot jump!';",
  },
  {
    name: '#68 the crew bonus stacks across contracts again',
    file: F('crew.js'),
    from: "      baseMaxHp: this.baseMaxHp ?? this.maxHp,",
    to:   "",
  },
  {
    name: '#68 a wanted man flies an ordinary patrol boat',
    file: F('game.js'),
    from: "      const w = _wantedHere;\n      if (w) {",
    to:   "      const w = null;\n      if (w) {",
  },
  {
    name: '#68 his two guns are the same gun twice',
    file: F('game.js'),
    // Re-aimed in update75: the call is `scrapWeapon` now — the same
    // line, and the same thing it guards (the bay must be cleared or
    // installWeapon refuses it and he flies with two starter lasers).
    from: "          if (_enemyShip.weapons[slot]) _enemyShip.scrapWeapon(slot);",
    to:   "          void 0;",
  },
  {
    name: '#68 a wanted man gets a one-bay hull he cannot arm',
    file: F('game.js'),
    // Re-aimed in update108 (`let`: the first contract may swap the hull).
    from: "    let layoutKey = groundKey ?? ((difficulty === 'hard' || _wantedHere)",
    to:   "    let layoutKey = groundKey ?? ((difficulty === 'hard')",
  },
  {
    name: '#68 blowing up a wanted man leaves no body',
    file: F('game.js'),
    from: "    _bagWantedCommander();\n\n    // The enemy commander leaves with his ship (update50).",
    to:   "    // The enemy commander leaves with his ship (update50).",
  },
  {
    name: '#68 an ordinary commander leaves a body too',
    file: F('game.js'),
    from: "    if (!cap || !cap.wantedId) return false;",
    to:   "    if (!cap) return false;",
  },
  {
    name: '#68 the region line lands back on the CONTRACT header',
    file: F('basescreen.js'),
    // Re-aimed in update113: the region line sits under the moon's blurb on the destination panel.
    from: "    ctx.fillText(`${reg.label} · CONTRACTS — more moons open with the Moon Gate`, P.x + 14, P.y + 68);",
    to:   "    ctx.fillText(`${reg.label} · CONTRACTS — more moons open with the Moon Gate`, P.x + 14, P.y + 42);",
  },
  {
    name: '#68 the memorial loses the not-recovered panel',
    file: F('basescreen.js'),
    from: "      const lost = (typeof Save !== 'undefined' && Save.notRecovered)\n        ? Save.notRecovered() : [];",
    to:   "      const lost = [];",
  },
  {
    name: '#68 a buried man is still listed as never recovered',
    file: F('save.js'),
    from: "    return (_data?.graveyard ?? []).filter(g => g && !g.buried);",
    to:   "    return (_data?.graveyard ?? []);",
  },
  {
    name: '#68 a lost commander leaves no trace at all',
    file: F('game.js'),
    from: "      Save.addCommanderToGraveyard?.(_commander);",
    to:   "      void 0;",
  },
  {
    name: '#68 a cat is listed as one of the hands',
    file: F('save.js'),
    from: "      pet:     !!crewMember.isPet,",
    to:   "      pet:     false,",
  },
  {
    name: '#68 an empty not-recovered list draws nothing',
    file: F('basescreen.js'),
    from: "        ctx.fillText('Everybody came home.', x, y0 + 4);",
    to:   "        ctx.fillText('', x, y0 + 4);",
  },
  {
    name: '#68 both sicknesses go back to the same colour',
    file: F('renderer.js'),
    from: "  const DISEASE_COL = { plague: '#3fd96b', virus: '#d9463c' };",
    to:   "  const DISEASE_COL = { plague: '#3fd96b', virus: '#3fd96b' };",
  },
  {
    name: '#68 SICK hides his hit points again',
    file: F('renderer.js'),
    from: "                : c.state === 'injured' ? { t: 'INJURED',  col: '#ffd700' }\n                : null;",
    to:   "                : c.state === 'injured' ? { t: 'INJURED',  col: '#ffd700' }\n                : c.infected ? { t: '\\u2623 SICK', col: '#3fd96b' }\n                : null;",
  },
  {
    name: '#68 a medkit stops curing the plague',
    file: F('game.js'),
    from: "      if (sick) {\n        sick.infected = false;",
    to:   "      if (false) {\n        sick.infected = false;",
  },
  {
    name: '#68 a medkit cures a void-spider bite too',
    file: F('game.js'),
    from: "        .filter(c => c.isPlayer && !c.dead && c.infected && !c.virus)[0];",
    to:   "        .filter(c => c.isPlayer && !c.dead && (c.infected || c.virus))[0];",
  },


  /* ── update69 ──────────────────────────────────────────── */
  {
    name: '#69 the door hit box swells back into the module',
    file: F('ship.js'),
    from: "  static get GRAB() { return 5; }",
    to:   "  static get GRAB() { return 13; }",
  },
  {
    name: '#69 the hit box stops following the door at all',
    file: F('game.js'),
    from: "      if (d.hits(mx, my)) {",
    to:   "      if (Utils.dist(mx, my, d.x, d.y) < 16) {",
  },
  {
    name: '#69 a hatch under the open menu eats the order again',
    file: F('game.js'),
    from: "    if (_bodyMenu) return false;\n    for (const d of _playerShip.doors) {",
    to:   "    for (const d of _playerShip.doors) {",
  },
  {
    name: '#69 the menu opens beside the man instead of under him',
    file: F('renderer.js'),
    from: "    const px = Utils.clamp(x - BODY_MENU_W / 2, 4, _W - BODY_MENU_W - 4);\n    const py = Utils.clamp(y + BODY_MENU_DROP, 4, _H - h - 4);",
    to:   "    const px = Utils.clamp(x + 8, 4, _W - BODY_MENU_W - 4);\n    const py = Utils.clamp(y - h / 2, 4, _H - h - 4);",
  },
  {
    name: '#69 the menu goes wide again',
    file: F('renderer.js'),
    from: "  const BODY_MENU_W = 50, BODY_MENU_ROW = 15, BODY_MENU_PAD = 3;",
    to:   "  const BODY_MENU_W = 74, BODY_MENU_ROW = 15, BODY_MENU_PAD = 3;",
  },
  {
    name: '#69 the menu follows the cursor instead of the man',
    file: F('game.js'),
    from: "      const ax = body ? body.x : mx;",
    to:   "      const ax = mx;",
  },
  {
    name: '#69 the cat gets her Polish names back',
    file: F('crew.js'),
    from: "  'Sputnik', 'Comet', 'Soot', 'Luna', 'Domino', 'Rusty',",
    to:   "  'Sputnik', 'Mruk', 'Pyza', 'Luna', 'Kropka', 'Rusty',",
  },
  {
    name: '#69 the barracks paints the virus green again',
    file: F('basescreen.js'),
    from: "    if (c?.virus)    return { glyph: '☣', col: COL.virus  ?? '#d9463c', tip: 'VIRUS' };",
    to:   "    if (c?.virus)    return { glyph: '☣', col: '#9fff7a', tip: 'VIRUS' };",
  },
  /* DELETED in update74: '#69 the roster prints a bare number again'.
     It guarded the M:SS readout against sliding back to a bare "5" —
     and update74 took the readout off the screen entirely, on the
     player's call. The line it aimed at no longer exists, so the
     revert could only ever report ANCHOR MISSING. What matters now is
     that the number does NOT come back, and revert '#74 the roster
     tells the player exactly when the virus fires' guards that. */
  {
    name: '#69 the bite stops counting down at all',
    file: F('ship.js'),
    from: "      c.virusT = before - dt;",
    to:   "      c.virusT = before;",
  },
  {
    name: '#69 the infection clock never runs',
    file: F('ship.js'),
    from: '    // ── The bite and the egg case, both on the clock ──\n    if (live) this.infectionTick(dt);',
    to:   '    // ── The bite and the egg case, both on the clock ──\n',
  },
  {
    name: '#69 the man who turns leaves a corpse as well',
    file: F('ship.js'),
    from: "    c.bagged = true;\n    this.crew = this.crew.filter(k => k !== c);",
    to:   "    c.bagged = true;",
  },
  {
    name: '#69 the egg forgets which room it was laid in',
    file: F('ship.js'),
    // Re-aimed in update84: the case is drawn in the duct, so it no longer carries a deck y.
    from: '      roomId: c.roomId,\n      x: c.x,',
    to:   '      x: c.x,',
  },
  {
    name: '#69 the stone stops saying what became of him',
    file: F('ship.js'),
    from: "    c.killedBy = 'the void-spider virus — he left an egg case';",
    to:   "    c.killedBy = 'unknown';",
  },
  {
    name: '#69 the egg stops hatching',
    file: F('ship.js'),
    from: "      m.hatchT = (m.hatchT ?? EGG_SECONDS) - dt;",
    to:   "      m.hatchT = (m.hatchT ?? EGG_SECONDS);",
  },
  {
    name: '#69 the spiders come out of a random module',
    file: F('ship.js'),
    from: "    const home = this.getRoomById(m.roomId) ||",
    to:   "    const home = null ||",
  },
  {
    name: '#69 the yard shelves the egg case with the ore',
    file: F('game.js'),
    from: "    const yardRefuses = (it) => isBody(it) || isEgg(it);",
    to:   "    const yardRefuses = (it) => isBody(it);",
  },
  {
    name: '#69 the crew help themselves to the rations again',
    file: F('ship.js'),
    from: "      if (c.hunger > H.HUNGRY) c._starveWarned = false;",
    to:   "      if (c.hunger > H.HUNGRY) c._starveWarned = false;\n      if (!c.isPet && c.alive && c.hunger < H.HUNGRY) this._startMeal(c);",
  },
  {
    name: '#69 the cat stops feeding herself too',
    file: F('ship.js'),
    // Re-aimed in update83: `starving` is worked out once at the top
    // of the cat's turn now, because the standing order has to ask the
    // same question before it decides whether to let her off the post.
    from: "      if (starving && this._startMeal(cat)) return;",
    to:   "      if (false && this._startMeal(cat)) return;",
  },
  {
    name: '#69 an errand re-posts the man who ran it',
    file: F('crew.js'),
    // Re-anchored in update97 (the healing ward joined the line).
    from: "        const post = (this._healing && this._healRoomId) || (this._errandRoomId ?? this.homeRoomId);",
    to:   "        const post = (this._healing && this._healRoomId) || this.homeRoomId;",
  },
  {
    name: '#69 the stretcher-bearer is re-stationed in the sick bay',
    file: F('ship.js'),
    from: "            c._errandRoomId = medRoom.id;",
    to:   "            c.homeRoomId = medRoom.id;",
  },
  {
    name: '#69 the errand never ends',
    file: F('ship.js'),
    from: "      if (c._errandRoomId && !c.carrying && !c._rescueId && !c._bagTargetId &&\n          c.roomId === c._errandRoomId) {\n        c._errandRoomId = null;\n      }",
    to:   "      void 0;",
  },
  {
    name: '#69 a second cat is offered to a ship that has one',
    file: F('map.js'),
    from: "  if (wantsPet && ship?.crew?.some(c => c.isPet && !c.dead)) return false;",
    to:   "  if (false) return false;",
  },
  {
    name: '#69 a maxed module is offered an upgrade',
    file: F('map.js'),
    from: "  if (up && sys.level >= (sys.def?.maxLevel ?? 8)) return false;",
    to:   "  if (false) return false;",
  },
  {
    name: '#69 the shield tuner comes back',
    file: F('map.js'),
    from: "  /* THE SHIELD TUNER IS GONE (update69, player's call).",
    to:   "  {\n    id: 'shield_tuner',\n    title: 'Shield Tuner',\n    text: 'A tender matches your course.',\n    requires: 'shields',\n    choices: [\n      { label: 'Let her aboard (30 CC)', result: { cost: 30, system_upgrade: 'shields' } },\n      { label: 'Wave her off', result: {} },\n    ],\n  },\n  /* THE SHIELD TUNER IS GONE (update69, player's call).",
  },
  {
    name: '#69 boarding a hull that is not there is allowed again',
    file: F('game.js'),
    from: "    const gone = !_enemyShip || _enemyShip.destroyed || _enemyShip.hull <= 0;",
    to:   "    const gone = !_enemyShip;",
  },
  {
    name: '#69 an ordinary captain is offered a cell again',
    file: F('game.js'),
    from: "      if (foeCap && foeCap.wantedId && !noQuarter && cells > 0) {",
    to:   "      if (foeCap && !noQuarter && cells > 0) {",
  },
  {
    name: '#69 the popup promises a cell to a man nobody pays for',
    file: F('game.js'),
    from: "            + (!foeCap.wantedId\n                ? 'Nobody is paying for this one — he is not on any board.'",
    to:   "            + (false\n                ? 'Nobody is paying for this one — he is not on any board.'",
  },

  /* ── update70 ──────────────────────────────────────────── */
  {
    name: '#70 a poster is pinned to no contract at all',
    file: F('save.js'),
    from: "      region: _data?.run?.region ?? DEFAULT_REGION,\n      mission: _spreadMission(),\n    };\n  }",
    to:   "      region: _data?.run?.region ?? DEFAULT_REGION,\n      mission: null,\n    };\n  }",
  },
  {
    name: '#70 the board stacks every name on one contract',
    file: F('save.js'),
    from: "    const min  = Math.min(...keys.map(k => count[k]));\n    const pool = keys.filter(k => count[k] === min);",
    to:   "    const pool = keys.slice(0, 1);",
  },
  {
    name: '#70 an old save never gets its addresses',
    file: F('save.js'),
    from: "    if (_addressOldPosters()) save();",
    to:   "    void 0;",
  },
  {
    name: '#70 the map seats anybody on anything again',
    file: F('map.js'),
    from: "    const open = Save.wantedFor ? Save.wantedFor(mission) : Save.wanted();",
    to:   "    const open = Save.wanted();",
  },
  {
    name: '#70 the board stops saying which contract to take',
    file: F('basescreen.js'),
    from: "      ctx.fillText(_clip(ctx, `on ${job}`, cw - 16), x + cw / 2, fy + S + 52);",
    to:   "      void job;",
  },
  {
    name: '#70 the poster rate goes back to two sectors in five',
    file: F('map.js'),
    from: "const WANTED_ON_MAP = 0.50;",
    to:   "const WANTED_ON_MAP = 0.40;",
  },
  {
    name: '#70 a clean commander is offered the black market',
    file: F('commander.js'),
    from: "  function pirateWillDeal(karma = karmaNow()) { return priceSurcharge(karma) > 0; }",
    to:   "  function pirateWillDeal(karma = karmaNow()) { return true; }",
  },
  {
    name: '#70 the pirate stops discounting anything',
    file: F('commander.js'),
    from: "    return karma <= KARMA_SHUNNED ? 0.45 : 0.30;",
    to:   "    return 0;",
  },
  {
    name: '#70 the shunned get no deeper cut than the merely distrusted',
    file: F('commander.js'),
    from: "    return karma <= KARMA_SHUNNED ? 0.45 : 0.30;",
    to:   "    return 0.30;",
  },
  {
    name: '#70 the parley is offered on every fight',
    file: F('game.js'),
    from: "    if (!w) return 'not a poster';",
    to:   "    if (false) return 'not a poster';",
  },
  {
    name: '#70 the parley never opens at all',
    file: F('game.js'),
    from: "      if (_maybeParley(diff)) return;",
    to:   "      if (false) return;",
  },
  {
    name: '#70 the parley loses a door',
    file: F('game.js'),
    // Re-aimed in update135: the door pays karma now (CON_A_CROOK).
    from: "        { label: `Accept, then open fire (+${conned} karma)`,\n          result: { combat: difficulty, ambush: true, karma: conned } },",
    to:   "",
  },
  {
    name: '#70 treachery is free',
    file: F('game.js'),
    // Re-aimed in update135: since jj's call it is not a cost but a reward — still never free.
    from: "          result: { combat: difficulty, ambush: true, karma: conned } },",
    to:   "          result: { combat: difficulty, ambush: true } },",
  },
  {
    name: '#70 the ambush leaves his shields up',
    file: F('game.js'),
    from: "      if (ss) { ss._shieldBars = 0; ss._shieldTimer = 0; }",
    to:   "      if (ss) { ss._shieldTimer = 0; }",
  },
  {
    name: '#70 trading leaves him on the node to be fought anyway',
    file: F('game.js'),
    from: "    if (node) node.wantedId = null;",
    to:   "    void 0;",
  },
  {
    name: '#70 trading takes him off the board as well',
    file: F('game.js'),
    from: "    const node = _sectorMap?.current?.();\n    if (node) node.wantedId = null;",
    to:   "    const node = _sectorMap?.current?.();\n    if (node) node.wantedId = null;\n    Save.deliverWanted?.(wantedId, 0);",
  },
  {
    name: '#70 the black market turns away the men it exists for',
    file: F('station.js'),
    from: "    if (this.blackMarket) return null;",
    to:   "    if (false) return null;",
  },
  {
    name: '#70 the pirate sells at port prices',
    file: F('station.js'),
    from: "  _goodsFactor() { return this.blackMarket ? this._priceFactor() : 1; }",
    to:   "  _goodsFactor() { return 1; }",
  },
  {
    name: '#70 a port starts charging karma on guns',
    file: F('station.js'),
    from: "  _goodsFactor() { return this.blackMarket ? this._priceFactor() : 1; }",
    to:   "  _goodsFactor() { return this._priceFactor(); }",
  },
  {
    name: '#70 the counter and the buy button quote different prices',
    file: F('ui.js'),
    from: "          const cost = s.weaponCost(item);",
    to:   "          const cost = def.cost;",
  },
  {
    name: '#70 his hold is empty of contraband',
    file: F('station.js'),
    from: "    push('contraband', ri(1, deep ? 4 : 3));",
    to:   "    void 0;",
  },
  {
    // Re-aimed in update99: the chips are gone, and so is the rule's
    // direction — the market must now sell NO tablets. The revert puts
    // them over his counter.
    name: '#70 he sells no chips',
    file: F('station.js'),
    from: "    /* No tablets here (update99): jj's tablets come from bosses and from",
    to:   "    Object.keys(CARGO_ITEMS).filter(k => CARGO_ITEMS[k].kind === 'tablet' && CARGO_ITEMS[k].chipLevel <= 2).slice(0, 3).forEach(k => push(k));\n    /* No tablets here (update99): jj's tablets come from bosses and from",
  },
  {
    name: '#70 he does dockyard work after all',
    file: F('station.js'),
    from: "      hullRepair: 0,\n      // He will spare a cell or two, at his price.",
    to:   "      hullRepair: 20,\n      // He will spare a cell or two, at his price.",
  },
  {
    name: '#70 buying a crate does not charge for it',
    file: F('station.js'),
    from: "    Save.updateRun({ scrap: run.scrap - cost });\n    Audio.sfx.scrapCollect?.();\n    return { ok: true, cost, message: `Loaded ${placed.label}.` };",
    to:   "    Audio.sfx.scrapCollect?.();\n    return { ok: true, cost, message: `Loaded ${placed.label}.` };",
  },
  {
    name: '#70 the same crate can be sold twice',
    file: F('station.js'),
    from: "    item.sold = true;\n    Save.updateRun({ scrap: run.scrap - cost });\n    Audio.sfx.scrapCollect?.();",
    to:   "    Save.updateRun({ scrap: run.scrap - cost });\n    Audio.sfx.scrapCollect?.();",
  },
  {
    name: '#70 hunger stops mattering to the work',
    file: F('crew.js'),
    from: "  repairSpeed()    { return (1 + this.getSkillLevel('repair') * 0.5)\n                          * (1 + this._capBonus().repair) * this.effortFactor(); }",
    to:   "  repairSpeed()    { return (1 + this.getSkillLevel('repair') * 0.5)\n                          * (1 + this._capBonus().repair); }",
  },
  {
    name: '#70 a fire burns the same whatever he has eaten',
    file: F('crew.js'),
    from: "  firefightSpeed() { return (1 + this.getSkillLevel('firefight') * 0.5)\n                          * (1 + this._capBonus().firefight) * this.effortFactor(); }",
    to:   "  firefightSpeed() { return (1 + this.getSkillLevel('firefight') * 0.5)\n                          * (1 + this._capBonus().firefight); }",
  },
  {
    name: '#70 a breach is patched the same on an empty stomach',
    file: F('crew.js'),
    from: "  breachSpeed()    { return (1 + this.getSkillLevel('breach')    * 0.5)\n                          * (1 + this._capBonus().breach) * this.effortFactor(); }",
    to:   "  breachSpeed()    { return (1 + this.getSkillLevel('breach')    * 0.5)\n                          * (1 + this._capBonus().breach); }",
  },
  {
    name: '#70 a full stomach is worth nothing over a half-empty one',
    file: F('crew.js'),
    from: "    if (h >= HUNGER.FED)      return E.fed;",
    to:   "    if (false)                return E.fed;",
  },
  {
    name: '#70 starving costs no more than hungry',
    file: F('crew.js'),
    from: "    if (h <= HUNGER.STARVING) return E.starving;",
    to:   "    if (false) return E.starving;",
  },
  {
    name: '#70 hunger reaches the gunnery and the knife too',
    file: F('crew.js'),
    from: "  combatDamage()   { return 1 + this.getSkillLevel('combat')   * 0.3; }",
    to:   "  combatDamage()   { return (1 + this.getSkillLevel('combat') * 0.3) * this.effortFactor(); }",
  },
  // #70 (vermin slowed by hunger) deleted in update84: there are no vermin in a crew list to be slowed.

  /* ── update71 ──────────────────────────────────────────── */
  {
    name: '#71 a contract carries no side jobs at all',
    file: F('game.js'),
    from: "    Save.rollRunGoals?.(mission.sectors ?? 1);",
    to:   "    void 0;",
  },
  {
    name: '#71 the goals stop scaling with the contract',
    file: F('save.js'),
    from: "      need: (s) => 4 + 3 * s, cc: (s) => 25 + 15 * s,",
    to:   "      need: (s) => 4, cc: (s) => 25,",
  },
  {
    name: '#71 two goals can be the same goal',
    file: F('save.js'),
    from: "    const keys = Utils.shuffle(Object.keys(RUN_GOAL_DEFS)).slice(0, Math.max(0, n));",
    to:   "    const keys = new Array(Math.max(0, n)).fill(Object.keys(RUN_GOAL_DEFS)[0]);",
  },
  {
    name: '#71 a kill is never counted',
    file: F('crew.js'),
    from: "      Save.goalEvent?.('crew_kills');",
    to:   "      void 0;",
  },
  // #71 (vermin count as enemy crew) deleted in update84: nothing on the far side of a brawl is an animal.
  {
    name: '#71 losing your own hull counts as a kill again',
    file: F('ship.js'),
    from: "    if (!this.isPlayer) {\n      Save.recordKill();\n      Save.goalEvent?.('ships');\n    }",
    to:   "    Save.recordKill();\n    Save.goalEvent?.('ships');",
  },
  {
    name: '#71 a destroyed hull is not counted at all',
    file: F('ship.js'),
    from: "      Save.goalEvent?.('ships');",
    to:   "      void 0;",
  },
  {
    name: '#71 a stripped wreck is not counted',
    file: F('game.js'),
    from: "    Save.goalEvent?.('wrecks');",
    to:   "    void 0;",
  },
  {
    name: '#71 nobody is named for the fire they beat',
    file: F('crew.js'),
    from: "          fire.suppress(dt * this.firefightSpeed(), this);",
    to:   "          fire.suppress(dt * this.firefightSpeed());",
  },
  {
    name: '#71 their fires count as ours',
    file: F('fire.js'),
    from: "      if (by && by.isPlayer && typeof Save !== 'undefined') Save.goalEvent?.('fires');",
    to:   "      if (typeof Save !== 'undefined') Save.goalEvent?.('fires');",
  },
  {
    name: '#71 a goal finishes before it is finished',
    file: F('save.js'),
    from: "      if (g.n >= g.need) g.done = true;",
    to:   "      g.done = true;",
  },
  {
    name: '#71 the counter runs past what was asked for',
    file: F('save.js'),
    from: "      g.n = Math.min(g.need, (g.n ?? 0) + amount);",
    to:   "      g.n = (g.n ?? 0) + amount;",
  },
  {
    name: '#71 a goal pays every frame',
    file: F('save.js'),
    from: "    if (!g || !g.done || g.paid) return false;",
    to:   "    if (!g || !g.done) return false;",
  },
  {
    name: '#71 nothing is ever paid out',
    file: F('game.js'),
    from: "      if (run) Save.updateRun({ scrap: (run.scrap ?? 0) + g.cc });",
    to:   "      void 0;",
  },
  {
    name: '#71 the payout is never drained',
    file: F('game.js'),
    from: "    _payRunGoals();",
    to:   "    void 0;",
  },
  {
    name: '#71 the HUD hands out the live records',
    file: F('save.js'),
    from: "    return (_data?.run?.goals ?? []).map(g => ({ ...g }));",
    to:   "    return (_data?.run?.goals ?? []);",
  },
  {
    name: '#71 the objective line is never drawn',
    file: F('renderer.js'),
    // Re-aimed in update98: the line takes a y (under the commander bar in a fight).
    from: "    _drawRunGoals(ctx, resX, barUp && !_compactCmd() ? CMD_BAR.y + CMD_BAR.h + 4 : RUN_GOALS_BOX.y);",
    to:   "    void 0;",
  },
  {
    name: '#71 the objective line draws on a run with no goals',
    file: F('renderer.js'),
    // Re-aimed in update74: the two literals moved into RUN_GOALS_BOX,
    // so the old anchor text stopped existing.
    // Re-aimed again in update98: y is a parameter now.
    from: "    if (!goals.length) return;\n    const h = RUN_GOALS_BOX.h;",
    to:   "    const h = RUN_GOALS_BOX.h;",
  },
  {
    name: '#71 the objective line stops showing progress',
    file: F('renderer.js'),
    from: "      const txt = g.done ? `✓ ${g.label}` : `${g.label} ${g.n}/${g.need}`;",
    to:   "      const txt = g.done ? `✓ ${g.label}` : `${g.label}`;",
  },
  {
    name: '#71 the objective line wraps onto a second row',
    file: F('renderer.js'),
    from: "      ctx.fillText(txt, x, y + 12);\n      x += ctx.measureText(txt).width + 14;",
    to:   "      ctx.fillText(txt, x, y + 12 + i * 11);\n      x += ctx.measureText(txt).width + 14;",
  },
  {
    name: '#71 the goals survive into the next contract',
    file: F('save.js'),
    from: "      goals: [],\n\n      seed: Math.floor(Math.random() * 1e9),",
    to:   "      goals: _data?.run?.goals ?? [],\n\n      seed: Math.floor(Math.random() * 1e9),",
  },
  {
    name: '#71 the difficulty ladder gets a karma gate too',
    file: F('base.js'),
    from: "    label: 'Courier Run',",
    to:   "    label: 'Courier Run',\n    karmaGate: 'high',",
  },
  {
    name: '#71 the relief run is open to anybody',
    file: F('base.js'),
    from: "  if (m.karmaGate === 'high' && col < 4) {",
    to:   "  if (false) {",
  },
  {
    name: '#71 the dirty contract is offered to a saint',
    file: F('base.js'),
    from: "  if (m.karmaGate === 'low' && col > 2) {",
    to:   "  if (false) {",
  },
  {
    name: '#71 the gate stops reading the board\'s own wall',
    file: F('base.js'),
    from: "  const col = (typeof Chips !== 'undefined' && Chips.wallColumn)\n    ? Chips.wallColumn(k) : 3;",
    to:   "  const col = k >= 50 ? 5 : 1;",
  },
  {
    name: '#71 a shut contract can be launched anyway',
    file: F('base.js'),
    from: "      const why = missionRefusal(MISSIONS[mission]);\n      if (why) return { ok: false, message: why };",
    to:   "      void 0;",
  },
  {
    name: '#71 a shut contract is silent about why',
    file: F('basescreen.js'),
    // Re-aimed in update113 (the contract cards are on the destination screen).
    from: "          _wrap(ctx, closed, c.x + 14, c.y + 38, c.w - 28, 13, 3);",
    to:   "          void 0;",
  },
  {
    name: '#73 the reason is cut off where the card ends',
    file: F('basescreen.js'),
    // Re-aimed in update113 (the contract cards are on the destination screen).
    from: "          _wrap(ctx, closed, c.x + 14, c.y + 38, c.w - 28, 13, 3);",
    to:   "          ctx.fillText(_clip(ctx, closed, c.w - 28), c.x + 14, c.y + 38);",
  },
  {
    name: '#71 a shut contract is still clickable',
    file: F('basescreen.js'),
    // Re-aimed in update113: a shut card on the destination screen gets a zone again.
    from: "        if (closed) {\n          _destLock(ctx, c.x + c.w - 16, c.y + 16, '#ff8a95');",
    to:   "        _zones.push({ x: c.x, y: c.y, w: c.w, h: c.h, act: 'mission', arg: m.id });\n        if (closed) {\n          _destLock(ctx, c.x + c.w - 16, c.y + 16, '#ff8a95');",
  },
  {
    name: '#71 the blurb runs over the line below it again',
    file: F('basescreen.js'),
    // Re-aimed in update113 (the contract cards are on the destination screen).
    from: "          _wrap(ctx, m.blurb, c.x + 14, c.y + 36, c.w - 28, 13, 2);",
    to:   "          _wrap(ctx, m.blurb, c.x + 14, c.y + 36, c.w - 28, 13);",
  },
  {
    name: '#71 the relief run pays no karma',
    file: F('game.js'),
    from: "    if (mission.karmaPay && _commander && typeof Commander !== 'undefined') {",
    to:   "    if (false && _commander && typeof Commander !== 'undefined') {",
  },
  {
    name: '#71 the relief run brings nothing home from the lab',
    file: F('game.js'),
    from: "    if (mission.chipReward) _awardChip({ minLevel: 1, maxLevel: 2 }, 'the people you got out');",
    to:   "    void 0;",
  },
  {
    name: '#71 the dirty contract costs nothing',
    file: F('base.js'),
    from: "    karmaPay: 'ROBBERY',",
    to:   "    karmaPay: null,",
  },
  {
    name: '#71 the dirty contract pays no better than an honest one',
    file: F('base.js'),
    from: "    ccBonus: 160,                // this is why anybody takes it",
    to:   "    ccBonus: 60,                 // this is why anybody takes it",
  },

  /* ── update72 ──────────────────────────────────────────── */
  {
    name: '#72 a boarding party beats the man it came to free',
    file: F('crew.js'),
    from: "      const foes = ship.crew.filter(k =>\n        k.alive && k.inRoom !== false && !k.isPrisoner &&",
    to:   "      const foes = ship.crew.filter(k =>\n        k.alive && k.inRoom !== false &&",
  },
  {
    name: '#72 a prisoner swings back',
    file: F('crew.js'),
    from: "    if (ship && this.inRoom !== false && !this.isPrisoner) {",
    to:   "    if (ship && this.inRoom !== false) {",
  },
  {
    name: '#72 the prisoner flag does not survive a save',
    file: F('crew.js'),
    from: "      isPrisoner: this.isPrisoner, rescued: this.rescued,",
    to:   "      rescued: this.rescued,",
  },
  {
    name: '#72 walking into the cell block frees nobody',
    file: F('ship.js'),
    from: "    // ── Anybody's prisoners, found by somebody else's boarders ──\n    this.freeCaptives();",
    to:   "    // ── Anybody's prisoners, found by somebody else's boarders ──",
  },
  {
    name: '#72 a freed man is still theirs',
    file: F('ship.js'),
    from: "      p.isPrisoner = false;\n      p.isPlayer   = true;",
    to:   "      p.isPrisoner = false;",
  },
  {
    name: '#72 nobody records who was rescued',
    file: F('ship.js'),
    from: "      p.rescued    = true;",
    to:   "      void 0;",
  },
  {
    name: '#72 a freed man stays painted in their red',
    file: F('ship.js'),
    from: "      if (p.race === 'hostile' && typeof CORP_KEYS !== 'undefined') {\n        p.race = Utils.pick(CORP_KEYS);\n      }",
    to:   "      void 0;",
  },
  {
    name: '#72 the man breaking out is "rescued" by his own guards',
    file: F('ship.js'),
    from: "    const held = this.crew.filter(c => c.isPrisoner && c.alive && !c._breakingOut && !c.frozen);",
    to:   "    const held = this.crew.filter(c => c.isPrisoner && c.alive && !c.frozen);",
  },
  {
    name: '#72 a man in their cell counts as a defender again',
    file: F('game.js'),
    // Re-aimed in update84: the `!isPet` beside it went with the hostile animals.
    from: '_enemyShip.crew.filter(c => !c.isPlayer && !c.isPrisoner && c.alive).length',
    to:   '_enemyShip.crew.filter(c => !c.isPlayer && c.alive).length',
  },
  {
    name: '#72 captives are seated in a compartment that does not exist',
    file: F('game.js'),
    from: "      if (!room) return 0;",
    to:   "      if (false) return 0;",
  },
  {
    name: '#72 every hull with a brig carries captives',
    file: F('game.js'),
    from: "    if (Math.random() >= CAPTIVE_CHANCE) return 0;",
    to:   "    if (false) return 0;",
  },
  {
    name: '#72 no hull ever carries captives',
    file: F('game.js'),
    from: "    _seatCaptives();",
    to:   "    void 0;",
  },
  {
    name: '#72 the yard pays nothing for the people you got out',
    file: F('game.js'),
    from: "    if (rep.rescued > 0 && _commander && typeof Commander !== 'undefined') {",
    to:   "    if (false && _commander && typeof Commander !== 'undefined') {",
  },
  {
    name: '#72 the dock stops counting who was rescued',
    file: F('base.js'),
    from: "      if (c && c.rescued) report.rescued++;",
    to:   "      void 0;",
  },
  {
    name: '#72 the escape goes back to being a line of text',
    file: F('ship.js'),
    from: "      this.addCrew(runner, true);",
    to:   "      void runner;",
  },
  {
    name: '#72 the escaper is one of ours',
    file: F('ship.js'),
    from: "        isPlayer: false, isPrisoner: true,",
    to:   "        isPlayer: true, isPrisoner: true,",
  },
  {
    name: '#72 the escaper keeps his name to himself',
    file: F('ship.js'),
    from: "        name: p.name, race: p.race || 'hostile',",
    to:   "        race: p.race || 'hostile',",
  },
  {
    name: '#72 the board is written the moment the cell opens',
    file: F('ship.js'),
    from: "      const brig = this.getRoomById(this.getSystem('carbonite')?.roomId) || this.rooms[0];",
    to:   "      Save.reWanted?.({ wantedId: p.wantedId ?? null, name: p.name, bounty: p.bounty });\n      const brig = this.getRoomById(this.getSystem('carbonite')?.roomId) || this.rooms[0];",
  },
  {
    name: '#72 he walks out through a locked hatch',
    file: F('ship.js'),
    from: "      } else if (air.hackBy('enemy', dt)) {",
    to:   "      } else if (true) {",
  },
  {
    name: '#72 he never reaches the airlock at all',
    file: F('ship.js'),
    from: "    if (!c._waypoints?.length) c.moveToOnShip?.(this, air.x, air.y);",
    to:   "    void 0;",
  },
  {
    name: '#72 an escaped commander goes up as a beginner',
    file: F('ship.js'),
    from: "      runner.level    = p.level;",
    to:   "      runner.level    = p.level ?? 1;",
  },
  {
    name: '#72 an escaper poster has no contract on it',
    file: F('save.js'),
    from: "      mission: _spreadMission(),\n    };\n    _harden(w);",
    to:   "    };\n    _harden(w);",
  },
  {
    name: '#72 a cornered man cannot be put back',
    file: F('game.js'),
    from: "    if (person.isPrisoner) return person.dead ? ['eject', 'bag'] : ['cell'];",
    to:   "    if (false) return ['cell'];",
  },
  {
    name: '#72 the cell order is accepted with the bay dark',
    file: F('ship.js'),
    // update77 folded the three lines both refusals shared into
    // `_slabRefusal`, which is where this now lives — and there is
    // only one of it, so the anchor is unique again.
    from: "    if (this.carboniteCapacity() <= 0) return 'the carbonite bay is cold \u2014 no power';",
    to:   "    ;",
  },
  {
    name: '#72 a man put back in the cell is also left in the corridor',
    file: F('ship.js'),
    from: "    this.crew = this.crew.filter(k => k !== c);\n    return { ok: true, message: `${c.name} is back in the cell.` };",
    to:   "    return { ok: true, message: `${c.name} is back in the cell.` };",
  },
  {
    name: '#72 the cursor cannot find the man out of the cell',
    file: F('game.js'),
    from: "      if (!c.isPlayer && !c.isPrisoner && !theirDead) return false;",
    to:   "      if (!c.isPlayer && !theirDead) return false;",
  },
  {
    name: '#72 a prisoner is put to work like a crewman',
    file: F('ship.js'),
    from: "      if (c.isPrisoner) { this._prisonerWalk(c, dt); return; }",
    to:   "      if (c.isPrisoner) { this._prisonerWalk(c, dt); }",
  },

  // ── update73: the tile grid, the duct, and a hull with a profile ──
  {
    name: '#73 a length that is not a whole number of tiles',
    file: F('ship.js'),
    from: "  MODULE_W: 10 * TILE,   // 100",
    to:   "  MODULE_W: 95,          // 100",
  },
  {
    name: '#73 the compartment stands up again instead of lying down',
    file: F('ship.js'),
    from: "  MODULE_H:  7 * TILE,   // 70 — INCLUDING the duct along its ceiling",
    to:   "  MODULE_H: 12 * TILE,   // 70 — INCLUDING the duct along its ceiling",
  },
  {
    name: '#73 the duct is squeezed out of the module',
    file: F('ship.js'),
    from: "  VENT_H:    2 * TILE,   // the duct: two rows of tiles of the module",
    to:   "  VENT_H:    0,          // the duct: two rows of tiles of the module",
  },
  {
    name: '#73 a second gap between decks beside the duct',
    file: F('ship.js'),
    from: "  DECK_GAP:  0,          // the duct IS the gap between decks now",
    to:   "  DECK_GAP:  1 * TILE,   // the duct IS the gap between decks now",
  },
  {
    name: '#73 the walk line is measured through the ceiling again',
    file: F('ship.js'),
    from: "  return (HULL_GRID.DUCT_BELOW ? 0 : HULL_GRID.VENT_H)\n       + (HULL_GRID.MODULE_H - HULL_GRID.VENT_H) * HULL_GRID.WALK_FRAC;",
    to:   "  return HULL_GRID.MODULE_H * HULL_GRID.WALK_FRAC;",
  },
  {
    name: '#73 floorWalkY keeps its own copy of the walk fraction',
    file: F('ship.js'),
    from: "    return roomsOnFloor[0].y + walkOffset();",
    to:   "    return roomsOnFloor[0].y + roomsOnFloor[0].h * 0.65;",
  },
  {
    name: '#73 a module is fitted into the ceiling',
    file: F('ship.js'),
    from: "    sys.roomY  = room.floorTop;\n    sys.roomW  = room.w;\n    sys.roomH  = room.floorH;",
    to:   "    sys.roomY  = room.y;\n    sys.roomW  = room.w;\n    sys.roomH  = room.h;",
  },
  {
    name: '#73 the enemy is spawned back off the right of the screen',
    file: F('ship.js'),
    from: "  static get ENEMY_STATION()  { return { x: 780, y: 200 }; }",
    to:   "  static get ENEMY_STATION()  { return { x: 880, y: 200 }; }",
  },
  {
    name: '#73 the player hull is slid over the orders panel',
    file: F('ship.js'),
    from: "  static get PLAYER_STATION() { return { x: 145, y: 180 }; }",
    to:   "  static get PLAYER_STATION() { return { x: 90, y: 180 }; }",
  },
  {
    name: '#73 the starter hull goes back to being a rectangle',
    file: F('ship.js'),
    from: "      { id:'r_hold',     type:'empty',    col:3, row:1, adjacent:['r_reactor'] },",
    to:   "      { id:'r_hold',     type:'empty',    col:2, row:0, adjacent:['r_weapons'] },",
  },
  {
    name: '#73 the spur hands the starter a SECOND free bay',
    file: F('ship.js'),
    from: "      { id:'r_weapons',  type:'weapons',  col:1, row:0, adjacent:['r_engines'] },",
    to:   "      { id:'r_weapons',  type:'weapons',  col:1, row:0, adjacent:['r_engines'] },\n      { id:'r_hold2',    type:'empty',    col:2, row:0, adjacent:['r_weapons'] },",
  },
  {
    name: '#73 the hull plate notches around every lift trunk',
    file: F('ship.js'),
    from: "    (this.elevators?.shafts ?? []).forEach(sh => {\n      ctx.roundRect(sh.x - half, b.y - M, half * 2, b.h + M * 2, R);\n    });",
    to:   "    (this.elevators?.shafts ?? []).forEach(() => {});",
  },
  {
    name: '#73 the plate goes back to one box round the bounding box',
    file: F('ship.js'),
    from: "    this.rooms.forEach(r => {\n      ctx.roundRect(r.x - M, r.y - M, r.w + M * 2, r.h + M * 2, R);\n    });",
    to:   "    const bb = this.roomBounds();\n    ctx.roundRect(bb.x - M, bb.y - M, bb.w + M * 2, bb.h + M * 2, R);",
  },
  {
    name: '#73/#90a the module prints its name plate again',
    file: F('systems.js'),
    // Re-aimed in update90a: the plate is gone at the player's ask; this puts one back.
    from: '    /* NO NAME IN THE ROOM (update90a).',
    to:   '    ctx.fillText(this.label, x + 5, y + h - 6);\n    /* NO NAME IN THE ROOM (update90a).',
  },

  {
    name: '#90a the module badge loses its hover',
    file: F('ui.js'),
    // Re-aimed in update90a: losing the plate is now the rule; the name lives in the badge's hover.
    from: '      return b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;',
    to:   '      return false && b;',
  },


  // ── update73a: a duct the beasts fit in, and drawn art ──
  {
    name: '#73a the duct goes back to one tile and the cat will not fit',
    file: F('ship.js'),
    from: "  VENT_H:    2 * TILE,   // the duct: two rows of tiles of the module",
    to:   "  VENT_H:    1 * TILE,   // the duct: two rows of tiles of the module",
    browser: true,
  },
  {
    name: '#73a the taller duct is taken out of the deck instead',
    file: F('ship.js'),
    from: "  MODULE_H:  7 * TILE,   // 70 — INCLUDING the duct along its ceiling",
    to:   "  MODULE_H:  6 * TILE,   // 70 — INCLUDING the duct along its ceiling",
  },
  {
    name: '#73a a file that never answers hangs the boot',
    file: F('assets.js'),
    from: "      const t = setTimeout(() => finish(value), ms);",
    to:   "      const t = 0;",
  },
  {
    name: '#73a drawn art is loaded but never swapped in',
    file: F('assets.js'),
    from: "      _sprites.set(name, img);\n      _source.set(name, 'file');\n      return true;",
    to:   "      return true;",
  },
  {
    name: '#73a the generators are never overridden at all',
    file: F('assets.js'),
    from: "    try { await _loadDrawnArt(onProgress); } catch (_) { /* generated art stands */ }",
    to:   "    ;",
  },
  {
    name: '#73a the self-documenting manifest form stops being read',
    file: F('assets.js'),
    from: "               : Array.isArray(body?.sprites) ? body.sprites\n               : [];",
    to:   "               : [];",
  },
  {
    name: '#73a a broken manifest takes the boot down with it',
    file: F('assets.js'),
    from: "    return list.filter(n => typeof n === 'string');",
    to:   "    return list.map(n => n.toUpperCase());",
  },

  // ── update74: every module wears its own badge ──
  {
    name: '#74 the reactor goes back to wearing the engines badge',
    file: F('systems.js'),
    from: "    label: 'Reactor', icon: 'icon_reactor',",
    to:   "    label: 'Reactor', icon: 'icon_engines',",
  },
  {
    name: '#74 the cloak goes back to wearing the engines badge',
    file: F('systems.js'),
    from: "    label: 'Cloak', icon: 'icon_cloaking',",
    to:   "    label: 'Cloak', icon: 'icon_engines',",
  },
  {
    name: '#74 the repair bay goes back to the medbay cross',
    file: F('systems.js'),
    from: "    label: 'Repair Bay', icon: 'icon_autorepair',",
    to:   "    label: 'Repair Bay', icon: 'icon_medbay',",
  },
  {
    name: '#74 the carbonite bay goes back to the medbay cross',
    file: F('systems.js'),
    from: "    label: 'Carbonite', icon: 'icon_carbonite',",
    to:   "    label: 'Carbonite', icon: 'icon_medbay',",
  },
  {
    name: '#74 the artillery goes back to the ordinary gun',
    file: F('systems.js'),
    from: "    label: 'Artillery', icon: 'icon_artillery',",
    to:   "    label: 'Artillery', icon: 'icon_weapons',",
  },
  {
    name: '#74 a module names a badge nothing draws',
    file: F('systems.js'),
    from: "    label: 'Carbonite', icon: 'icon_carbonite',",
    to:   "    label: 'Carbonite', icon: 'icon_cryobay',",
  },
  {
    name: '#74 the five new badges are never generated',
    file: F('assets.js'),
    from: "      ['icon_reactor',   () => _genSystemIcon('reactor')],",
    to:   "      ",
  },
  {
    name: '#74 TAB flips the view on the map again instead of walking the crew',
    file: F('game.js'),
    from: "    if (Input.isPressed('Tab')) _cycleCrew();\n\n    if (btnClick || Input.isPressed('KeyM')) {",
    to:   "    if (btnClick || Input.isPressed('Tab') || Input.isPressed('KeyM')) {",
  },
  {
    name: '#74 M stops flipping the view',
    file: F('game.js'),
    from: "    if (btnClick || Input.isPressed('KeyM')) {",
    to:   "    if (btnClick) {",
  },
  {
    name: '#74 the hill plants a cross for a body nobody brought home',
    file: F('basescreen.js'),
    from: "    const graves = all.filter(g => g && g.buried);",
    to:   "    const graves = all;",
  },
  {
    name: '#74 the roster tells the player exactly when the virus fires',
    file: F('renderer.js'),
    /* Re-aimed twice: in update76 the mark moved into the strip, and
       in update80 the strip stopped drawing TEXT at all — it draws an
       icon. So the countdown is put back at the one place the strip
       still touches every mark. What it guards is unchanged: the
       player is never told how long the virus has left. */
    from: "        ctx.globalAlpha = 1;\n        _crewMarkZones.push({ x: mx - 1, y: my - 1, w: MARK_STEP, h: MARK_SIZE + 2,",
    to:   "        ctx.globalAlpha = 1;\n        if (m.key === 'virus') { ctx.font = '8px monospace'; ctx.textAlign = 'left';\n          const t = Math.max(0, Math.ceil(c.virusT ?? 0));\n          ctx.fillText(`${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`, mx, my + 22); }\n        _crewMarkZones.push({ x: mx - 1, y: my - 1, w: MARK_STEP, h: MARK_SIZE + 2,",
  },
  {
    name: '#74 the salvage clock goes back to the minute it was',
    file: F('ship.js'),
    from: "  static get LOOT_SECONDS() { return 30; }",
    to:   "  static get LOOT_SECONDS() { return 50; }",
  },
  {
    /* Aimed at the line that is actually READ. The module-level
       initialiser a few lines up looks like the same fact, but
       `_startWreckBoarding` overwrites it before anything reads it —
       reverting THAT one changes nothing, which is a fact about the
       code rather than a gap in the tests. */
    name: '#74 the salvage clock is copied instead of read',
    file: F('game.js'),
    from: "    _wreckSecs   = opts.seconds ?? Ship.LOOT_SECONDS;",
    to:   "    _wreckSecs   = opts.seconds ?? 50;",
  },
  {
    name: '#74 SHOW MAP is drawn through the objective line again',
    file: F('game.js'),
    from: "    return box.y + box.h + _TOP_BTN_GAP;",
    to:   "    return 42;",
  },
  {
    name: '#74 the top buttons move when a contract has no objectives',
    file: F('game.js'),
    from: "    const box = Renderer.runGoalsBox ? Renderer.runGoalsBox() : { y: 40, h: 17 };\n    return box.y + box.h + _TOP_BTN_GAP;",
    to:   "    const r = Renderer.runGoalsRect ? Renderer.runGoalsRect() : null;\n    return (r ? r.y + r.h : 40) + _TOP_BTN_GAP;",
  },
  // ── update75 — the weightless rack, the shop, the floor tile ──
  {
    name: '#75 the weightless gun rack comes back',
    file: F('ship.js'),
    from: "    this.weapons     = [];",
    to:   "    this.weapons     = [];\n    this.weaponCargo = [];",
  },
  {
    name: "#75 an old save's guns are dropped instead of boxed",
    file: F('ship.js'),
    from: "    (data.weaponCargo ?? []).forEach(key => {",
    to:   "    [].forEach(key => {",
  },
  {
    name: '#75 the shop charges for a gun it cannot deliver',
    file: F('station.js'),
    from: "    let where = null;",
    to:   "    item.sold = true;\n    Save.updateRun({ scrap: run.scrap - cost });\n    let where = null;",
  },
  {
    name: '#75 a gun you are handed goes nowhere again',
    file: F('game.js'),
    from: "      if (_playerShip.boxWeapon(result.weaponReward)) {",
    to:   "      if (!_playerShip) {",
  },
  {
    name: '#75 selling a boxed gun leaves the crate in the hold',
    file: F('station.js'),
    from: "    const price = Math.floor((WEAPON_DEFS[key]?.cost ?? 20) * 0.5);\n    ship.cargo.remove(crate);",
    to:   "    const price = Math.floor((WEAPON_DEFS[key]?.cost ?? 20) * 0.5);",
  },
  {
    name: '#75 the station sells a crate that is not in this hold',
    file: F('station.js'),
    from: "    if (!ship.cargo?.items.includes(crate)) {\n      return { ok: false, message: 'That crate is not in this hold.' };\n    }\n    const price",
    to:   "    const price",
  },
  {
    name: '#75 the station fits a crate that is not in this hold',
    file: F('station.js'),
    from: "    if (!ship.cargo?.items.includes(crate)) {\n      return { ok: false, message: 'That crate is not in this hold.' };\n    }\n    if (ship.weapons[slot])",
    to:   "    if (ship.weapons[slot])",
  },
  {
    name: '#75 enemy setup stows her starter gun instead of scrapping it',
    file: F('game.js'),
    from: "          if (_enemyShip.weapons[slot]) _enemyShip.scrapWeapon(slot);",
    to:   "          if (_enemyShip.weapons[slot]) _enemyShip.uninstallWeapon(slot);",
  },
  {
    name: '#75 a spare gun that will not fit dies on the launch pad',
    file: F('game.js'),
    from: "      const back = Base.storeWeapon?.(key);",
    to:   "      const back = false;",
  },
  {
    name: '#75 the Heavy Laser goes back into a middle crate',
    file: F('cargo.js'),
    from: "  if (cost <= 65) return 'gun_crate';",
    to:   "  if (cost <= 75) return 'gun_crate';",
  },
  {
    name: '#75 the floor tile is squashed against the wall again',
    file: F('assets.js'),
    from: "        ctx.drawImage(sprite, 0, 0, dw * kx, dh * ky, x + tx, y + ty, dw, dh);",
    to:   "        ctx.drawImage(sprite, 0, 0, sprite.width, sprite.height, x + tx, y + ty, dw, dh);",
  },
  {
    name: '#75 a zero tile size hangs the frame',
    file: F('assets.js'),
    from: "    if (!sprite || !(cell > 0)) return;",
    to:   "    if (!sprite) return;\n    if (!(cell > 0)) cell = 48;",
  },
  {
    name: '#75 the airlock button says VENT again',
    file: F('renderer.js'),
    from: "    const LABEL = { treat: 'TREAT', eject: 'EJECT', bag: 'BAG', feed: 'FEED',",
    to:   "    const LABEL = { treat: 'TREAT', eject: 'VENT', bag: 'BAG', feed: 'FEED',",
  },
  // ── update76 — the pause, and the mark strip ──
  {
    name: '#76 P is a second pause key again',
    file: F('game.js'),
    from: "  function _step(dt) {",
    to:   "  function _step(dt) {\n    if (Input.isPressed('KeyP')) _paused = !_paused;",
  },
  {
    name: '#76 the pause freezes the player too',
    file: F('game.js'),
    // Re-aimed in update99: the Book pauses too.
    from: "    _update(_paused || _B().open ? 0 : dt);",
    to:   "    if (!_paused) _update(_B().open ? 0 : dt);",
  },
  {
    name: '#76 the wreck clock can be paused as well',
    file: F('game.js'),
    from: "  function _canPause() { return STATE === 'combat' || STATE === 'map'; }",
    to:   "  function _canPause() { return true; }",
  },
  {
    name: '#76 walking off a paused screen leaves the pause on',
    file: F('game.js'),
    from: "    if (!_canPause()) _paused = false;",
    to:   "    ;",
  },
  {
    name: '#76 the pause curtain comes back down',
    file: F('game.js'),
    from: "    ctx.beginPath(); ctx.roundRect(x, y, w, PAUSE_BAR_H, 4); ctx.fill();",
    to:   "    ctx.fillRect(0, 0, W, H);",
  },
  {
    name: '#76 leaving a won fight is on SPACE again',
    file: F('game.js'),
    from: "      if (_combatTimer > 1.0 && (Input.isPressed('Enter') ||",
    to:   "      if (_combatTimer > 1.0 && (Input.isPressed('Space') ||",
  },
  {
    name: '#76 the outcome screen is on SPACE again',
    file: F('game.js'),
    from: "    if (_outcomeTimer > 1.0 && (Input.isPressed('Enter') ||",
    to:   "    if (_outcomeTimer > 1.0 && (Input.isPressed('Space') ||",
  },
  {
    name: '#76 only the worse of two diseases is shown',
    file: F('renderer.js'),
    // Re-aimed in update80: every mark carries an icon key now.
    from: "    if (c.infected) out.push({ key: 'plague', icon: 'plague', glyph: '\u2623',",
    to:   "    if (c.infected && !c.virus) out.push({ key: 'plague', icon: 'plague', glyph: '\u2623',",
  },
  {
    name: '#76 hunger is invisible on the roster again',
    file: F('renderer.js'),
    // Re-aimed in update84: `c.eats` went — everybody in a crew list eats.
    // Re-aimed in update87: the mark also steps aside while he eats.
    from: '    if (typeof HUNGER !== \'undefined\' && !(c.busy && c._busyAct === \'eat\')) {',
    to:   '    if (false) {',
  },
  {
    name: '#76 everybody in the room is shown working the module',
    file: F('renderer.js'),
    from: "               && ship.consoleOperator(c.roomId) === c) {",
    to:   "               && ship.crewInRoom(c.roomId).includes(c)) {",
  },
  {
    name: '#76 a boarder is shown working a module he is nowhere near',
    file: F('renderer.js'),
    from: "    } else if (ship && typeof ship.consoleOperator === 'function'",
    to:   "    }\n    if (ship && typeof ship.consoleOperator === 'function'",
  },
  {
    name: '#76 the marks go back inside the row',
    file: F('renderer.js'),
    /* Re-aimed in update80. The strip lives INSIDE the card now, so
       "put the marks back in the row" is no longer a breakage — it is
       the fix. What the update76 screenshot actually caught was the
       detail panel being drawn over the strip, so that is what this
       puts back: marks that run past `CREW_PANEL_X`. */
    from: "        const mx = cx + 4 + mi * MARK_STEP;",
    to:   "        const mx = cx + cw + 30 + mi * MARK_STEP;",
  },
  {
    name: '#76 a mark cannot say what it is',
    file: F('renderer.js'),
    // Re-aimed in update80: the zone got the strip's new geometry.
    from: "                              tip: m.tip });",
    to:   "                              tip: undefined });",
  },
  {
    name: '#76 the carbonite bay draws a question mark again',
    file: F('renderer.js'),
    from: "    carbonite: '\u25a3',",
    to:   "",
  },
  {
    name: '#76 the pause banner sits on the weapon panel again',
    file: F('game.js'),
    from: "    const x = W - w - 12, y = H - PAUSE_BAR_H - 8;",
    to:   "    const x = W / 2 - w / 2, y = H - PAUSE_BAR_H - 8;",
  },
  // ── update77 — carbonite ──
  {
    name: '#77 an old save with a brig loses its module',
    file: F('systems.js'),
    from: "const SYSTEM_ALIASES = { brig: 'carbonite' };",
    to:   "const SYSTEM_ALIASES = {};",
  },
  {
    name: '#77 slabs stop counting power again',
    file: F('ship.js'),
    from: "    return Math.max(0, Math.min(b.workingLevels, b.effectivePower()));",
    to:   "    return Math.max(0, b.workingLevels);",
  },
  {
    name: '#77 a frozen man still spends a slab',
    file: F('ship.js'),
    from: "    return Math.max(0, this.carboniteCapacity()\n                     - this.prisoners.length - this.frozenCrew().length);",
    to:   "    return Math.max(0, this.carboniteCapacity() - this.prisoners.length);",
  },
  {
    name: '#77 the virus clock runs inside the slab',
    file: F('ship.js'),
    from: "      if (!c || !c.isPlayer || c.dead || c.frozen || !c.virus) return;",
    to:   "      if (!c || !c.isPlayer || c.dead || !c.virus) return;",
  },
  {
    name: '#77 a frozen man gets hungry',
    file: F('ship.js'),
    // Re-aimed in update84: `!c.eats` went — everybody in a crew list eats.
    from: '      if (!c || c.dead || c.frozen) return;\n\n      // Mid-meal',
    to:   '      if (!c || c.dead) return;\n\n      // Mid-meal',
  },
  {
    name: '#77 a frozen man is still standing in the room',
    file: F('ship.js'),
    from: "      if (c.frozen) return;",
    to:   "      ;",
  },
  {
    name: '#77 freezing works from across the ship',
    file: F('ship.js'),
    // Re-aimed after `_slabRefusal` was folded out of this function.
    from: "    if (c.roomId !== this.getSystem('carbonite').roomId) {",
    to:   "    if (false) {",
  },
  {
    name: '#77 the slabs never let go when the power drops',
    file: F('ship.js'),
    from: "    this.carboniteTick(dt);",   // update127: the tick takes dt (the melt)
    to:   "    ;",
  },
  {
    name: '#77 the wrong man comes out of the slab',
    file: F('ship.js'),
    from: "    const queue = this.frozenCrew().sort((a, b) => (b._slabSeq ?? 0) - (a._slabSeq ?? 0));",
    to:   "    const queue = this.frozenCrew().sort((a, b) => (a._slabSeq ?? 0) - (b._slabSeq ?? 0));",
  },
  {
    name: '#77 a convict with no slab sits quietly again',
    file: F('ship.js'),
    from: "    const slabs = Math.min(this.prisoners.length, this.carboniteCapacity());",
    to:   "    const slabs = this.getSystem('carbonite')?.isDisabled() ? 0 : this.prisoners.length;",
  },
  {
    name: '#77 a man is banked into the barracks still frozen',
    file: F('game.js'),
    from: "      .forEach(c => _playerShip.thawCrew(c, 'the ship is powering down'));",
    to:   "      .forEach(c => c);",
  },
  {
    name: '#77 the slab readout counts only convicts',
    file: F('renderer.js'),
    from: "    const held  = (ship.prisoners ? ship.prisoners.length : 0)\n                + (ship.frozenCrew ? ship.frozenCrew().length : 0);",
    to:   "    const held  = (ship.prisoners ? ship.prisoners.length : 0);",
  },
  {
    name: '#77 a frozen man is drawn as though nothing were wrong',
    file: F('renderer.js'),
    from: "    if (c.frozen) {",
    to:   "    if (false) {",
  },
  {
    name: '#77 the menu has no way to freeze anybody',
    file: F('game.js'),
    // Re-anchored in update97 (HEAL joined FEED).
    from: "    return _playerShip?.getSystem('carbonite') ? ['feed', 'heal', 'freeze'] : ['feed', 'heal'];",
    to:   "    return ['feed', 'heal'];",
  },
  {
    name: '#77 the slab order is lost on reload',
    file: F('crew.js'),
    from: "    this.frozen      = !!cfg.frozen;",
    to:   "    this.frozen      = false;",
  },
  // ── update78 — a bandage, a medkit and a ward ──
  {
    name: '#78 the bandage is free again',
    file: F('ship.js'),
    from: "      if (!this.hasDoses(Ship.AID_DOSES)) {",
    to:   "      if (false) {",
  },
  {
    name: '#78 the bandage costs nothing when it lands',
    file: F('ship.js'),
    from: "    if (!this.spendDoses(Ship.AID_DOSES)) return;   // somebody used the last one",
    to:   "    ;",
  },
  {
    name: '#78 a bandage puts him back on his feet again',
    file: F('ship.js'),
    from: "    body._bandaged = true;\n    body._bleedT   = 0;",
    to:   "    body._bandaged = true;\n    body._bleedT   = 0;\n    body.state = 'ok';",
  },
  {
    name: '#78 a bandaged man is still on the clock',
    file: F('ship.js'),
    from: "      if (c._bandaged) { c._bleedT = 0; return; }",
    to:   "      ;",
  },
  {
    name: '#78 the ward races its own patient',
    file: F('ship.js'),
    from: "      if (this._wardIsOpen() && c.roomId === this.getSystem('medbay')?.roomId) {",
    to:   "      if (false) {",
  },
  {
    name: '#78 a medkit costs one dose, like a bandage',
    file: F('ship.js'),
    from: "  static get MEDKIT_DOSES() { return 2; }   // \u2026and get him up",
    to:   "  static get MEDKIT_DOSES() { return 1; }",
  },
  {
    name: '#78 a medkit heals him to full',
    file: F('ship.js'),
    from: "    body.hp     = Math.max(body.hp, floor);",
    to:   "    body.hp     = body.maxHp;",
  },
  {
    name: '#78 a medkit pushes a healthier man DOWN to the floor value',
    file: F('ship.js'),
    from: "    const floor = Math.round(body.maxHp * Ship.MEDKIT_SHARE);\n",
    to:   "    const floor = body.maxHp;\n",
  },
  {
    name: '#78 the ward stops at the point he stands up',
    file: F('ship.js'),
    // Re-aimed in update82: the guard is on its own line now.
    from: "        if (b.hp >= b.maxHp) return;",
    to:   "        if (b.hp >= b.maxHp * Ship.MEDKIT_SHARE) return;",
  },
  {
    name: '#78 the ward goes back to treating only the men on its floor',
    file: F('ship.js'),
    // Re-aimed in update82: the patient list is worked out once, for
    // the cure clock AND the healing, and the loop walks what it was
    // handed. The question is unchanged — able and down alike.
    from: "      ? this.medbayPatients(medRoom.id) : [];",
    to:   "      ? this.bodiesInRoom(medRoom.id) : [];",
  },
  {
    name: '#78 the patients are the able only, as they were',
    file: F('ship.js'),
    from: "    return this.crew.filter(c =>\n      c && !c.dead && c.roomId === roomId && c.inRoom !== false &&\n      c.isPlayer === this.isPlayer);",
    to:   "    return this.crewInRoom(roomId);",
  },
  {
    name: '#78 the ship keeps sending hands to a man who has stopped bleeding',
    file: F('ship.js'),
    from: "        if (body._bandaged && body.bodyOrder !== 'treat'\n            && body.bodyOrder !== 'medkit' && !wardOpen) return;",
    to:   "        ;",
  },
  {
    name: '#78 the medic never leaves the man he bandaged',
    file: F('ship.js'),
    from: "        const patched = !!t && t._bandaged && !stillWanted;",
    to:   "        const patched = false;",
  },
  {
    name: '#78 the menu offers a corpse what a casualty needs',
    file: F('game.js'),
    from: "    if (person.dead) return ['eject', 'bag'];\n    if (person.down) return ['treat', 'medkit'];",
    to:   "    if (person.dead || person.down) return ['treat', 'eject', 'bag'];",
  },
  {
    name: '#78 eating stops taking any time at all',
    file: F('ship.js'),
    // Re-aimed in update87: the length is per act now.
    from: '    who._busyT   = secs ?? len;',
    to:   '    who._busyT   = 0.0001;',
  },
  {
    name: '#78 a man eating still mans his console',
    file: F('ship.js'),
    from: "    return this.crewInRoom(roomId).filter(c => !c.isPet && !c.busy);",
    to:   "    return this.crewInRoom(roomId).filter(c => !c.isPet);",
  },
  {
    name: '#78 nothing on the row says his hands are full',
    file: F('renderer.js'),
    from: "    if (c.busy) {\n      const act = c._busyAct;",
    to:   "    if (false) {\n      const act = c._busyAct;",
  },
  {
    name: '#78 a bleeding casualty looks exactly like a patched one',
    file: F('renderer.js'),
    // Re-aimed in update80: every mark carries an icon key now.
    from: "      out.push(c._bandaged\n        ? { key: 'stable',   icon: 'medical', glyph: '✚', col: '#7fe08a',",
    to:   "      out.push(true\n        ? { key: 'stable',   icon: 'medical', glyph: '✚', col: '#7fe08a',",
  },
  {
    name: '#78 the casualty mark is not drawn at all',
    file: F('renderer.js'),
    from: "    if (c.down) {\n      out.push(c._bandaged",
    to:   "    if (false) {\n      out.push(c._bandaged",
  },
  {
    name: '#79 boarders eat our places in the module again',
    file: F('ship.js'),
    // Re-aimed in update83: the same line also stopped counting animals.
    from: "      c && c.alive && !c.isPet && c.isPlayer === side && !exclude.includes(c) &&",
    to:   "      c && c.alive && !c.isPet && !exclude.includes(c) &&",
  },
  {
    name: '#79 the home click counts capacity out by hand again',
    file: F('game.js'),
    from: "    let space = _playerShip.roomSpaceFor(room.id, true, homeSel);",
    to:   "    let space = Math.max(0, 3 - _playerShip.crew.filter(c => c.alive && !homeSel.includes(c) && (c.roomId === room.id || c.homeRoomId === room.id)).length);",
  },
  {
    name: '#79 the enemy hull keeps a capacity rule of its own',
    file: F('game.js'),
    from: "          const movers = aboard.slice(0, _enemyShip.roomSpaceFor(eRoom.id, true, aboard));",
    to:   "          const movers = aboard.slice(0, 3);",
  },
  {
    name: '#79 nobody can be relieved',
    file: F('game.js'),
    from: "      space += _relieveInRoom(room, homeSel, homeSel.length - space);",
    to:   "      space += 0;",
  },
  {
    name: '#79 a relief no longer has to be an improvement',
    file: F('game.js'),
    from: "      if (frac(man) >= frac(bar)) break;           // no improvement, no relief",
    to:   "      if (false) break;",
  },
  {
    name: '#79 the relieved man is never actually moved',
    file: F('game.js'),
    from: "      man.homeRoomId = dest.id;",
    to:   "      man.homeRoomId = room.id;",
  },
  {
    name: '#79 an intruder holds our console again',
    file: F('ship.js'),
    from: "      if (c.isPlayer !== side) return;",
    to:   "      if (false) return;",
  },
  {
    name: '#79 everyone piles onto the first enemy again',
    file: F('crew.js'),
    from: "        const target = this.meleeTarget(ship, foes);",
    to:   "        const target = foes[0];",
  },
  {
    name: '#79 the pairing stops being mutual',
    file: F('crew.js'),
    // NOT `.reverse()`: reversing one side reverses the pairing
    // SYMMETRICALLY, so it is still mutual and still holds still — a
    // different valid answer, not a broken one. Dropping the sort is
    // the real breakage, and it only shows on a roster whose order is
    // not the id order (see the shuffle in section 257).
    from: "    const them = foes.slice().sort(byId);",
    to:   "    const them = foes.slice();",
  },
  {
    name: '#79 the spare man crowds the wrong duel',
    file: F('crew.js'),
    from: "    return them[(i < 0 ? 0 : i) % them.length];",
    to:   "    return them[Math.min(i < 0 ? 0 : i, them.length - 1)];",
  },
  {
    name: '#79 the enemy sends exactly two again',
    file: F('game.js'),
    from: "        const send   = Math.min(Ship.ROOM_SLOTS, alive.length - 1);",
    to:   "        const send   = 2;",
  },
  {
    name: '#79 our own boarding party loses its cap',
    file: F('game.js'),
    from: "      .filter(c => c.alive && _playerShip.crew.includes(c)).slice(0, Ship.ROOM_SLOTS);",
    to:   "      .filter(c => c.alive && _playerShip.crew.includes(c));",
  },
  {
    name: '#79 the spider breathes again',
    file: F('pests.js'),
    // Re-aimed in update84: the spider is a Pest; its air bill is Pest.breathPerSec.
    from: '    if (!this.alive || !this.breathes()) return 0;',
    to:   '    if (!this.alive) return 0;',
  },
  {
    name: '#79 nothing says the spider has no lungs',
    file: F('crew.js'),
    from: "  NO_LUNGS: { spider: true },",
    to:   "  NO_LUNGS: {},",
  },
  {
    name: '#79 the base screen goes back to a shelf per call',
    file: F('basescreen.js'),
    from: "    if (!_store) _store = Base.storeGrid();\n    return _store;",
    to:   "    return Base.storeGrid();",
  },
  {
    name: '#79 every boarder is named on the deck again',
    file: F('crew.js'),
    from: "    if (this.isPlayer && this.nameShown()) {\n      ctx.save();\n      ctx.font = '9px Share Tech Mono, monospace';",
    to:   "    if (true) {\n      ctx.save();\n      ctx.font = '9px Share Tech Mono, monospace';",
  },
  {
    name: '#79 both sides draw their health bars on one row',
    file: F('crew.js'),
    from: "      const by = this.y + (this.isPlayer ? -19 - LIFT : 6);",
    to:   "      const by = this.y - 19 - LIFT;",
  },
  {
    name: '#79 the CPU screen deserialises its own shelf again',
    file: F('game.js'),
    from: "    const shelf = BaseScreen?.liveShelf?.() ?? Base.warehouseGrid?.();",
    to:   "    const shelf = Base.warehouseGrid?.();",
  },
  {
    name: '#80 the strip stops saying he is putting out a fire',
    file: F('renderer.js'),
    from: "      if (c.task === TASK.FIRE) {",
    to:   "      if (false) {",
  },
  {
    name: '#80 the strip stops saying he is patching a breach',
    file: F('renderer.js'),
    from: "      } else if (c.task === TASK.BREACH) {",
    to:   "      } else if (false) {",
  },
  {
    name: '#80 the strip stops saying he is repairing',
    file: F('renderer.js'),
    from: "      } else if (c.task === TASK.REPAIR) {",
    to:   "      } else if (false) {",
  },
  {
    name: '#80 nothing says he is in a fight',
    file: F('renderer.js'),
    from: "                  && !c._awayTeam && !c.down && ship.roomContested(c.roomId);",
    to:   "                  && false;",
  },
  {
    name: '#80 the panel prints the stale task right through a brawl',
    file: F('renderer.js'),
    from: "    } else if (!c.down) {",
    to:   "    }\n    if (!c.down) {",
  },
  {
    name: '#80 an empty air tank is not on the panel',
    file: F('renderer.js'),
    from: "      out.push({ key: 'air', icon: 'air', glyph: '◇', col: '#4db8ff', pulse: true,",
    to:   "      if (false) out.push({ key: 'air', icon: 'air', glyph: '◇', col: '#4db8ff', pulse: true,",
  },
  {
    name: '#80 a mark names an icon that does not exist',
    file: F('renderer.js'),
    from: "        out.push({ key: 'firefighting', icon: 'fire', glyph: '▲', col: '#ff7c20',",
    to:   "        out.push({ key: 'firefighting', icon: 'flame', glyph: '▲', col: '#ff7c20',",
  },
  {
    name: '#80 the deck draws nothing over his head at all',
    file: F('crew.js'),
    from: "    if (!this.dead && typeof Renderer !== 'undefined'",
    to:   "    if (false && typeof Renderer !== 'undefined'",
  },
  {
    name: '#80 the deck shows everything the roster does',
    file: F('crew.js'),
    from: "    return ['virus', 'plague', 'air', 'starving', 'hungry'];",
    to:   "    return ['virus', 'plague', 'air', 'starving', 'hungry', 'repairing', 'fighting'];",
  },
  {
    name: '#80 the top bar forgets the doses',
    file: F('renderer.js'),
    // Re-aimed in update130 (the plate's new slots).
    from: "      drawStatIcon(ctx, 'medical', resX + 303, 17, 12, dCol);\n      ctx.fillStyle = dCol;\n      ctx.fillText(`${doses}`, resX + 319, 28);",
    to:   "      drawStatIcon(ctx, 'medical', resX + 303, 17, 12, dCol);",
  },
  {
    name: '#80 the top bar forgets the rations',
    file: F('renderer.js'),
    // Re-aimed in update130: the ration tin, in the plate's new slots.
    from: "      drawStatIcon(ctx, 'ration', resX + 346, 17, 12, fCol);\n      ctx.fillStyle = fCol;\n      ctx.fillText(`${food}`, resX + 362, 28);",
    to:   "      drawStatIcon(ctx, 'ration', resX + 346, 17, 12, fCol);",
  },
  {
    name: '#80 the dose readout is a number of its own again',
    file: F('renderer.js'),
    from: "      const doses = typeof ship.doseCount === 'function' ? ship.doseCount() : 0;",
    to:   "      const doses = 10;",
  },
  {
    name: '#80 our guns fire from the corner of the hull again',
    file: F('combat.js'),
    from: "    const fromX = muzzle ? muzzle.x : pb.x + pb.w + 10;",
    to:   "    const fromX = pb.x + pb.w + 10;",
  },
  {
    name: '#80 their guns fire from the corner of their hull again',
    file: F('combat.js'),
    from: "      const fromX = em ? em.x : eb.x - 10;",
    to:   "      const fromX = eb.x - 10;",
  },
  {
    name: '#80 a gun no longer knows where its own barrel is',
    file: F('ship.js'),
    from: "    const m = this.weaponMounts().find(q => q.weapon === weapon);",
    to:   "    const m = null;",
  },
  {
    name: '#80 the muzzle is the wrong end of the gun',
    file: F('ship.js'),
    from: "        muzzleX: dir > 0 ? x + GW : x,",
    to:   "        muzzleX: x,",
  },
  {
    name: '#80 the beam appears out of empty space beside the target',
    file: F('weapons.js'),
    from: "    ctx.moveTo(this.x, this.y);",
    to:   "    ctx.moveTo(shipX, this.y);",
  },
  {
    name: '#80 the strip goes back to a 2 x 2 in the gutter',
    file: F('renderer.js'),
    from: "        const mx = cx + 4 + mi * MARK_STEP;",
    to:   "        const mx = cx + cw + 4 + (mi % 2) * MARK_STEP;",
  },
  {
    name: '#80 the card stops making room for the strip',
    file: F('renderer.js'),
    from: "      const cx = 14, cw = 100, ch = CREW_ROW_H;   // update54: was 120",
    to:   "      const cx = 14, cw = 100, ch = 26;   // update54: was 120",
  },
  {
    name: '#80 the marks go back to being small',
    file: F('renderer.js'),
    from: "  const MARK_STEP = 15, MARK_SIZE = 14, MARK_MAX = 8;",
    to:   "  const MARK_STEP = 15, MARK_SIZE = 10, MARK_MAX = 8;",
  },
  {
    name: '#81 nobody helps himself to a ration again',
    file: F('ship.js'),
    // Re-aimed in update87: he helps himself only once it hurts.
    from: '      if (c.hunger <= 0 && !c.busy && !c.isPet && !c.down',
    to:   '      if (false && !c.busy && !c.isPet && !c.down',
  },
  {
    name: '#81 a man opens a ration in the middle of a brawl',
    file: F('ship.js'),
    from: "          && !this.roomContested(c.roomId)) {",
    to:   "          && true) {",
  },
  {
    name: '#81 a boarder lives off the hold he came to loot',
    file: F('ship.js'),
    from: "          && c.isPlayer === this.isPlayer",
    to:   "",
  },
  {
    name: '#81 the automatic mouth takes the best box on the shelf',
    file: F('ship.js'),
    from: "    return edible.reduce((a, b) =>\n      ((b.def?.hunger ?? 50) < (a.def?.hunger ?? 50) ? b : a));",
    to:   "    return edible.reduce((a, b) =>\n      ((b.def?.hunger ?? 50) > (a.def?.hunger ?? 50) ? b : a));",
  },
  {
    name: '#81 the meal is whatever was packed nearest the top left',
    file: F('ship.js'),
    from: "    return edible.reduce((a, b) =>\n      ((b.def?.hunger ?? 50) < (a.def?.hunger ?? 50) ? b : a));",
    to:   "    return edible[0];",
  },
  {
    name: '#81 the cat keeps a meal chooser of its own',
    file: F('ship.js'),
    from: "    const meal = this.mealFor(who);\n    if (!meal) return false;",
    to:   "    const meal = (this.cargo?.items ?? []).find(it =>\n      it.def?.tag === 'egg' && who.isPet && !it.damaged)\n      || (this.cargo?.items ?? []).find(it =>\n      it.def?.tag === 'food' && !it.damaged && this.willEat(who, it));\n    if (!meal) return false;",
  },
  {
    name: '#81 the cat leaves the egg to hatch',
    file: F('ship.js'),
    // Re-aimed in update86: the rats joined this line; the break takes the cat out of it.
    from: '    if (who?.isPet || who?.isRat) {       // the rats too (update86, U10B)',
    to:   '    if (who?.isRat) {',
  },
  {
    name: '#81 a man eats and works with the same pair of hands',
    file: F('crew.js'),
    from: "    if (this.busy) return;\n\n    switch (this.task) {",
    to:   "    switch (this.task) {",
  },
  {
    name: '#82 the ward is as good as what you PAID for, damage and all',
    file: F('ship.js'),
    from: "    return Math.max(0, Math.min(med.workingLevels, med.effectivePower()));",
    to:   "    return Math.max(0, med.level);",
  },
  {
    name: '#82 a level one ward cures everything',
    file: F('ship.js'),
    from: "  static get CURE_LEVELS() { return { plague: 3, virus: 5 }; }",
    to:   "  static get CURE_LEVELS() { return { plague: 1, virus: 1 }; }",
  },
  {
    name: '#82 the cure clock is not reset by walking out',
    file: F('ship.js'),
    from: "    if (!inWard) { b._cureT = 0; return; }",
    to:   "    if (!inWard) return;",
  },
  {
    name: '#82 the cure lands the frame he walks in',
    file: F('ship.js'),
    from: "    if (b._cureT < Ship.CURE_SECONDS) return;",
    to:   "    if (false) return;",
  },
  {
    name: '#82 the virus clock is left where the bite put it',
    file: F('ship.js'),
    from: "      b.virusT = (typeof VIRUS_SECONDS !== 'undefined') ? VIRUS_SECONDS : 0;",
    to:   "",
  },
  {
    name: '#82 the patient wanders off the table again',
    file: F('crew.js'),
    from: "    if (this.infected && ship && !(this._cureT > 0)) {",
    to:   "    if (this.infected && ship) {",
  },
  {
    name: '#82 every mouth breathes the same, cat and rat alike',
    file: F('oxygen.js'),
    from: "      consumption += (c.breathPerSec ? c.breathPerSec() : OXYGEN.BREATHING);",
    to:   "      consumption += OXYGEN.BREATHING;",
  },
  {
    name: '#82 a man in a slab is charged for air he is not breathing',
    file: F('oxygen.js'),
    from: "      if (!c || c.dead || c.dying || c.frozen || c.inRoom === false) return;",
    to:   "      if (!c || c.dead || c.dying) return;",
  },
  {
    name: '#82 the module makes its full output in EVERY room again',
    file: F('oxygen.js'),
    from: "    const production = OXYGEN.PER_POWER * o2Power;\n    const net = production - consumption;",
    to:   "    const production = OXYGEN.PER_POWER * o2Power * ship.rooms.length;\n    const net = production - consumption;",
  },
  {
    name: '#82 a surplus is pumped into compartments that are already full',
    file: F('oxygen.js'),
    from: "      ? (hungry.length ? net / hungry.length : 0)",
    to:   "      ? net / (rooms.length || 1)",
  },
  {
    name: '#82 the room works out an air balance of its own again',
    file: F('oxygen.js'),
    // Re-aimed in update86b: the call gained the flow flag.
    from: '      this._pipe(netRate * dt, flowing);   // see OXYGEN.DUCT_THIN for the order',
    to:   '      this._pipe((0.06 * netRate - OXYGEN.BREATHING) * dt, flowing);',
  },
  {
    name: '#82 a pip stops being worth three men',
    file: F('oxygen.js'),
    from: "  PER_POWER:      0.04 * 3,",
    to:   "  PER_POWER:      0.04 * 6,",
  },
  // #82 (spider charged for air) deleted in update84: it was the same line as #79 once the spider left crew.js.
  {
    name: '#82 the crew list grows over the reactor column again',
    file: F('renderer.js'),
    // Re-anchored in update97 (the list scrolls now).
    from: "    const shown    = roster.slice(_rosterScroll, _rosterScroll + win);",
    to:   "    const shown    = roster;",
  },
  {
    name: '#82 the men who did not fit are dropped without a word',
    file: F('renderer.js'),
    // Re-anchored in update97 (above and below the window).
    from: "      ctx.fillText(`▲${above} ▼${below} · WHEEL`, 14, crewY + 9);",
    to:   "      ;",
  },
  {
    name: '#82 the floor stops following the reactor',
    file: F('renderer.js'),
    from: "    const topPip = (_H - 52) - 20 - 12 - Math.max(0, cap - 1) * 12;",
    to:   "    const topPip = (_H - 52) - 20 - 12;",
  },
  {
    name: '#82 the order panel height is guessed at again',
    file: F('renderer.js'),
    // Re-aimed in update98: the specials left the panel, four rows remain.
    from: "    return 12 + 4 * (ORDER_BH + ORDER_GAP) + 6;",
    to:   "    return 10;",
  },
  {
    name: '#83 the cat is ordered about like a mechanic again',
    file: F('game.js'),
    from: "      if (m.isPet) {",
    to:   "      if (false) {",
  },
  {
    name: '#83 nothing marks the cat order as an order',
    file: F('game.js'),
    from: "        m._ordered = true;",
    to:   "        m._ordered = false;",
  },
  {
    name: '#83 the standing order is read but never obeyed',
    file: F('ship.js'),
    from: "      if (cat._ordered) {",
    to:   "      if (false) {",
  },
  {
    name: '#83 the order lasts only as long as the walk',
    file: F('ship.js'),
    from: "        if (!prey && !hurt && !starving) return;     // posted, and staying",
    to:   "        if (false) return;     // posted, and staying",
  },
  {
    name: '#83 a rat no longer calls her off the post',
    file: F('ship.js'),
    from: "        if (!prey && !hurt && !starving) return;     // posted, and staying",
    to:   "        if (!hurt && !starving) return;     // posted, and staying",
  },
  {
    name: '#83 a man on the floor no longer calls her off the post',
    file: F('ship.js'),
    from: "        if (!prey && !hurt && !starving) return;     // posted, and staying",
    to:   "        if (!prey && !starving) return;     // posted, and staying",
  },
  {
    name: '#83 she starves at her post',
    file: F('ship.js'),
    from: "        if (!prey && !hurt && !starving) return;     // posted, and staying",
    to:   "        if (!prey && !hurt) return;     // posted, and staying",
  },
  {
    name: '#83 the cat costs you a place in the module again',
    file: F('ship.js'),
    from: "      c && c.alive && !c.isPet && c.isPlayer === side && !exclude.includes(c) &&",
    to:   "      c && c.alive && c.isPlayer === side && !exclude.includes(c) &&",
  },
  {
    name: '#84 an old save drops its rats — a reload fumigates for free',
    file: F('game.js'),
    from: '      if (pest) { if (!pest.dead) _playerShip.addPest(pest); return; }',
    to:   '      if (pest) return;',
  },
  {
    name: '#84 an old save brings back its dead rats too',
    file: F('game.js'),
    from: '      if (pest) { if (!pest.dead) _playerShip.addPest(pest); return; }',
    to:   '      if (pest) { _playerShip.addPest(pest); return; }',
  },
  {
    name: '#84 a crewman-sized spider loads as a crewman-sized spider',
    file: F('pests.js'),
    from: '    p.maxHp = Math.min(p.maxHp, p.def.hp + p.def.hpPerTough * 3);\n',
    to:   '',
  },
  {
    name: '#84 the ship save writes its dead pests',
    file: F('ship.js'),
    from: '      pests: this.pests.filter(p => !p.dead).map(p => p.serialise()),',
    to:   '      pests: this.pests.map(p => p.serialise()),',
  },
  {
    name: '#84 the ship load forgets its pests',
    file: F('ship.js'),
    from: '    (data.pests ?? []).forEach(pd => ship.addPest(Pest.deserialise(pd)));',
    to:   '',
  },
  {
    name: '#84 a saved sac comes back hatched',
    file: F('pests.js'),
    from: '      dormant: this.dormant, revealed: this.revealed, hatchT: this.hatchT,',
    to:   '      hatchT: this.hatchT,',
  },
  {
    name: '#84 fire below does not reach the duct',
    file: F('ship.js'),
    // Re-aimed in update85: the line was rewritten for the duct's own air.
    from: '    if (this.fires?.ductBurning?.(this, p.roomId) && typeof FIRE_DEFS',
    to:   '    if (false && typeof FIRE_DEFS',
  },
  {
    name: '#84 the spider suffocates after all',
    file: F('ship.js'),
    // Re-aimed in update85: the line was rewritten for the duct's own air.
    from: '    if (p.breathes()) {\n      /* The DUCT',
    to:   '    if (true) {\n      /* The DUCT',
  },
  {
    name: '#84 vacuum does not kill a rat',
    file: F('ship.js'),
    // Re-aimed in update86b: the rat holds its breath first now.
    // Re-aimed in update90: "dry" is a wisp below ROOM_EMPTY, not 0.
    from: '      } else if (dry && (p.air',
    to:   '      } else if (false && (p.air',
  },
  {
    name: '#84 a pest crawls to any room, through the walls',
    file: F('ship.js'),
    // Re-aimed in update86a: the network is ductLinks now (sideways + the shaft).
    from: '        const next = this.ductLinks(room.id);',
    to:   '        const next = this.rooms.filter(r => r !== room).map(r => ({ room: r, shaft: null }));',
  },
  {
    name: '#84 a spider wanders instead of going where the people are',
    file: F('ship.js'),
    from: '        if (p.isSpider && !this._pestVictims(room.id).length) {',
    to:   '        if (false) {',
  },
  {
    name: '#84 a pest the cat is holding carries on as if free',
    file: F('ship.js'),
    from: '      if (this._pestVsCat(p, dt)) return;         // cornered, or killed',
    to:   '      this._pestVsCat(p, dt);',
  },
  {
    name: '#84 a cornered spider does not bite the cat',
    file: F('ship.js'),
    from: '        cat.takeDamage(p.biteDamage(), \'spider\');\n',
    to:   '',
  },
  {
    name: '#84 a dead cat stays up in the duct holding the spider',
    file: F('ship.js'),
    from: '        if (!cat.alive) {\n          this._catLetGo(cat);\n          p._catId = null;\n',
    to:   '        if (!cat.alive) {\n',
  },
  {
    name: '#84 a man walking in does not find the sac',
    file: F('ship.js'),
    from: '      if (inRoom) sac.revealed = true;\n',
    to:   '',
  },
  {
    name: '#84 the cat does not smell a sac next door',
    file: F('ship.js'),
    from: '      if (!sac.revealed) {\n        const nearCat',
    to:   '      if (false) {\n        const nearCat',
  },
  {
    name: '#84 a man under a sac does not hurry it',
    file: F('ship.js'),
    from: '      sac.hatchT -= dt * (inRoom ? 6 : 1);',
    to:   '      sac.hatchT -= dt;',
  },
  // #84 the yard does not fumigate — deleted in update86b: the player reversed it — the rats stay on the hull (see #86b).
  {
    name: '#84 the cat is re-routed every frame and never reaches another deck',
    file: F('ship.js'),
    from: '    if (last && Math.abs(last.x - tx) < 1 && Math.abs(last.y - ty) < 1) return true;\n',
    to:   '',
  },
  {
    name: '#84 a dead pest lingers in the list until the next tick',
    file: F('ship.js'),
    // Re-aimed in update86: one drop for spider and rat alike.
    from: '      this._pestDrop(p, dt);\n    });\n    this.pests = this.pests.filter(p => !p.dead);\n',
    to:   '      this._pestDrop(p, dt);\n    });\n',
  },
  {
    name: '#84 a rat in the duct takes no air',
    file: F('oxygen.js'),
    from: '    (ship.pests ?? []).forEach(p => { consumption += p.breathPerSec(); });',
    to:   '',
  },
  {
    name: '#84 the spider drops on the cat',
    file: F('ship.js'),
    from: '    return this.crew.filter(c => c && c.isPlayer && c.alive && !c.isPet &&',
    to:   '    return this.crew.filter(c => c && c.isPlayer && c.alive &&',
  },
  {
    name: '#84 a spider over a man wanders off before it drops',
    file: F('ship.js'),
    from: '    if (p._tx == null && p.isSpider && this._pestVictims(room.id).length) {',
    to:   '    if (false) {',
  },
  // #85 a deficit comes out of the room first — deleted in update86b: the player reversed it — a short supply SHOULD come out of the room first (see #86b).
  {
    name: '#85 a surplus fills the room first',
    file: F('oxygen.js'),
    from: '      const put = Math.min(amount, (OXYGEN.MAX - this.duct) / T);',
    to:   '      const put = Math.max(0, Math.min(amount - (OXYGEN.MAX - this.level), (OXYGEN.MAX - this.duct) / T));',
  },
  {
    name: '#85 the balance skips the duct altogether',
    file: F('oxygen.js'),
    // Re-aimed in update86b: the call gained the flow flag.
    from: '      this._pipe(netRate * dt, flowing);   // see OXYGEN.DUCT_THIN for the order',
    to:   '      this.level = Utils.clamp(this.level + netRate * dt, 0, OXYGEN.MAX);',
  },
  {
    name: '#85 a duct over an empty room never bleeds',
    file: F('oxygen.js'),
    from: '    if (leaking && this.duct != null && this.level <= OXYGEN.ROOM_EMPTY) {',
    to:   '    if (false) {',
  },
  {
    name: '#85 the duct bleeds along with the room',
    file: F('oxygen.js'),
    from: '    if (leaking && this.duct != null && this.level <= OXYGEN.ROOM_EMPTY) {',
    to:   '    if (leaking && this.duct != null && this.level < OXYGEN.MAX) {',
  },
  {
    name: '#85 a dry duct over a full room is not hungry',
    file: F('oxygen.js'),
    from: '      return ro.level < OXYGEN.MAX || (ro.duct != null && ro.duct < OXYGEN.MAX);',
    to:   '      return ro.level < OXYGEN.MAX;',
  },
  {
    name: '#85 the gauge ignores the ducts',
    file: F('oxygen.js'),
    from: '      if (r.duct != null) { sum += r.duct / T; cap += 1 / T; }\n',
    to:   '',
  },
  {
    name: '#85 a lift shaft gets a duct that never moves',
    file: F('ship.js'),
    from: 'this.oxygen.addRoom(`shaft_${s.id}`, { duct: false })',
    to:   'this.oxygen.addRoom(`shaft_${s.id}`)',
  },
  // #85 a pest breathes the room, not the duct — deleted in update86b: under the player's corrected
  // rule a duct is never empty while its room has air (a hole and a short supply empty the room
  // first, no supply empties both evenly), so room air and duct air give the same answer.
  {
    name: '#85 the fire below burns a pest the moment it starts',
    file: F('ship.js'),
    from: '    if (this.fires?.ductBurning?.(this, p.roomId) && typeof FIRE_DEFS',
    to:   '    if (this.fires?.hasFireInRoom?.(p.roomId) && typeof FIRE_DEFS',
  },
  {
    name: '#85 fire spreads without going through the duct',
    file: F('fire.js'),
    from: '      if (fire.spreadReady && this.ductBurning(ship, fire.roomId)) {',
    to:   '      if (fire.spreadReady) {',
  },
  {
    name: '#85 a dry duct burns anyway',
    file: F('fire.js'),
    from: '    if (ro && (ro.duct ?? 1) < FIRE_DEFS.DUCT_MIN_AIR) return false;\n',
    to:   '',
  },
  {
    name: '#85 a fire never ages, so its duct never catches',
    file: F('fire.js'),
    from: '    this.age = (this.age ?? 0) + dt;\n',
    to:   '',
  },
  {
    name: '#85 the duct catches the moment the module does',
    file: F('fire.js'),
    from: '(f.age ?? 0) >= FIRE_DEFS.DUCT_CATCH);',
    to:   'true);',
  },
  {
    name: '#85 the duct state is never drawn',
    file: F('ship.js'),
    // update128: the duct is drawn in two layers; its burning half is the back one
    from: "    this._drawDuctState(ctx, 'back');\n",
    to:   "",
  },
  {
    name: '#85 the duct gauge shows at any level',
    file: F('oxygen.js'),
    from: '    if (this.duct == null || this.duct >= OXYGEN.MAX * 0.95) return;',
    to:   '    if (this.duct == null) return;',
  },
  {
    name: '#86 a rat never gets hungry',
    file: F('ship.js'),
    from: '    rat.fullness = Math.max(0, (rat.fullness ?? 100) - T.HUNGER_PER_SEC * (rat.metab ?? 1) * dt);',
    to:   '    rat.fullness = rat.fullness ?? 100;',
  },
  {
    name: '#86 a rat eats whenever it can, fed or not',
    file: F('ship.js'),
    from: '    if (rat.fullness < T.EAT_BELOW) this._ratEat(rat);',
    to:   '    this._ratEat(rat);',
  },
  {
    name: '#86 a rat eats the whole stack',
    file: F('ship.js'),
    from: '      if (!isEgg && (meal.qty ?? 0) > 1) meal.qty--;\n      else this.cargo.remove(meal);\n      if (this.isPlayer && typeof UI !== \'undefined\') {\n        UI.notify(isEgg ? \'Something in the ducts',
    to:   '      this.cargo.remove(meal);\n      if (this.isPlayer && typeof UI !== \'undefined\') {\n        UI.notify(isEgg ? \'Something in the ducts',
  },
  {
    name: '#86 a meal does not grow a rat',
    file: F('ship.js'),
    from: '    rat.fullness = Math.min(100, rat.fullness + RAT_TUNING.MEAL);\n    this._ratGrow(rat);',
    to:   '    rat.fullness = Math.min(100, rat.fullness + RAT_TUNING.MEAL);',
  },
  {
    name: '#86 no litter',
    file: F('ship.js'),
    // Re-aimed in update86b: adults litter too.
    from: '    if (rat.level >= 2) this._ratLitter(rat);\n',
    to:   '',
  },
  {
    name: '#86 the litter ignores the cap',
    file: F('ship.js'),
    from: 'T.MAX_ABOARD - aboard);\n    if (!room || n <= 0) return 0;',
    to:   '99);\n    if (!room || n <= 0) return 0;',
  },
  {
    name: '#86 the pups are born grown',
    file: F('ship.js'),
    from: '        kind: \'rat\', level: 1, roomId: room.id,',
    to:   '        kind: \'rat\', level: 3, roomId: room.id,',
  },
  {
    name: '#86 rats leave the eggs alone',
    file: F('ship.js'),
    from: '    if (who?.isPet || who?.isRat) {       // the rats too (update86, U10B)',
    to:   '    if (who?.isPet) {',
  },
  {
    name: '#86 a rat ignores a sac in its own duct',
    file: F('ship.js'),
    from: '    const sac = this.pests.find(q => q !== rat && q.dormant && !q.dead && q.roomId === rat.roomId);',
    to:   '    const sac = null;',
  },
  {
    name: '#86 rats chew with food in the hold',
    file: F('ship.js'),
    from: '    const hungryForWire = !this._ratFood(rat);',
    to:   '    const hungryForWire = true;',
  },
  {
    name: '#86 any rat chews',
    file: F('ship.js'),
    from: '    if (rat.level >= 3 && hungryForWire) this._ratAct(rat, dt);',
    to:   '    if (hungryForWire) this._ratAct(rat, dt);',
  },
  {
    name: '#86 chewing starts at once',
    file: F('ship.js'),
    from: '    rat._chewT = (rat._chewT ?? Utils.randFloat(T.CHEW_MIN, T.CHEW_MAX)) - dt;',
    to:   '    rat._chewT = (rat._chewT ?? 0) - dt;',
  },
  {
    name: '#86 a chew takes two levels',
    file: F('ship.js'),
    from: '    sys.damageLevel(1);\n    Particles.floatText?.(room.cx, room.y + 22, \'CHEWED\'',
    to:   '    sys.damageLevel(2);\n    Particles.floatText?.(room.cx, room.y + 22, \'CHEWED\'',
  },
  {
    name: '#86 no rat ever bites',
    file: F('ship.js'),
    from: '          else this._ratBite(sp, victim);',
    to:   '          else {}',
  },
  {
    name: '#86 a fed adult bites too',
    file: F('ship.js'),
    from: '    return rat.level >= 3 && rat.fullness < RAT_TUNING.HUNGRY;',
    to:   '    return rat.level >= 3;',
  },
  {
    name: '#86 any rat bites',
    file: F('ship.js'),
    from: '    return rat.level >= 3 && rat.fullness < RAT_TUNING.HUNGRY;',
    to:   '    return rat.fullness < RAT_TUNING.HUNGRY;',
  },
  {
    name: '#86 a rat bite carries the virus',
    file: F('ship.js'),
    from: '          } else if (sp.isSpider) this._spiderBite(sp, victim);',
    to:   '          } else if (true) this._spiderBite(sp, victim);',
  },
  {
    name: '#86 a rat bites on the spider clock',
    file: F('ship.js'),
    from: '    // A rat\'s drop is one of the moves on its own clock — `_ratAct`.\n    if (sp.isRat) return;',
    to:   '    // (rats pounce on the spider clock)',
  },
  {
    name: '#86 a rat never starves',
    file: F('ship.js'),
    from: '        if (rat.takeDamage(1, \'starvation\')) {',
    to:   '        if (rat.takeDamage(0, \'starvation\')) {',
  },
  {
    name: '#86 starvation every tick',
    file: F('ship.js'),
    from: '      if (rat._starveT >= T.STARVE_EVERY) {',
    to:   '      if (rat._starveT >= 0) {',
  },
  {
    name: '#86 a starved rat lingers in the list',
    file: F('ship.js'),
    from: '      if (p.isRat && this._ratLife(p, dt)) return;   // starved',
    to:   '      if (p.isRat) this._ratLife(p, dt);',
  },
  {
    name: '#86 growing heals every wound',
    file: F('pests.js'),
    from: '    this.hp = Math.max(1, this.maxHp - lost);',
    to:   '    this.hp = this.maxHp;',
  },
  {
    name: '#86 a rat grows past adult',
    file: F('pests.js'),
    from: '    if (!this.isRat || this.level >= 3) return false;',
    to:   '    if (!this.isRat || this.level >= 4) return false;',
  },
  {
    name: '#86 the save forgets a rat\'s level',
    file: F('pests.js'),
    from: '      ...(this.isRat ? { level: this.level, fullness: this.fullness, metab: this.metab } : {}),',
    to:   '',
  },
  {
    name: '#86 an old-save rat loads young',
    file: F('pests.js'),
    from: '      level: 2,          // an old-save rat',
    to:   '      level: 1,          // an old-save rat',
  },
  {
    name: '#86 every rat is drawn full size',
    file: F('pests.js'),
    from: '    this.anim?.draw(ctx, this.x, y, 32 * s, 32 * s);',
    to:   '    this.anim?.draw(ctx, this.x, y, 32, 32);',
  },
  {
    name: '#86a no shafts: pests stay on their deck',
    file: F('ship.js'),
    from: '      (this.elevators?.shafts ?? []).forEach(sh => {\n        const top',
    to:   '      ([]).forEach(sh => {\n        const top',
  },
  {
    name: '#86a the shaft skips decks',
    file: F('ship.js'),
    from: '          [a.floor - 1, a.floor + 1].forEach(f => {',
    to:   '          [a.floor - 2, a.floor + 2].forEach(f => {',
  },
  {
    name: '#86a the shaft crosses to the far side',
    file: F('ship.js'),
    from: '          const decks = onIt.filter(b => b.floor !== a.floor && Math.sign(b.cx - sh.x) === side);',
    to:   '          const decks = onIt.filter(b => b.floor !== a.floor);',
  },
  {
    name: '#86a a deck change is a teleport',
    file: F('ship.js'),
    from: '      if (to && shaft) {\n        const y0',
    to:   '      if (false) {\n        const y0',
  },
  {
    name: '#86a the climb is instant',
    file: F('ship.js'),
    from: 'dur: Math.abs(y1 - y0) / p.def.speed, to: to.id,',
    to:   'dur: 0, to: to.id,',
  },
  {
    name: '#86a the climb never ends',
    file: F('ship.js'),
    from: '    if (c.t < c.dur) return;\n    p._climb = null;',
    to:   '    if (true) return;\n    p._climb = null;',
  },
  {
    name: '#86a a spider ignores people up the shaft',
    file: F('ship.js'),
    from: '          go = next.find(l => this._pestVictims(l.room.id).length) || null;',
    to:   '          go = next.find(l => !l.shaft && this._pestVictims(l.room.id).length) || null;',
  },
  {
    name: '#86a the cat catches a rat in the shaft',
    file: F('ship.js'),
    from: '    if (p._climb) return false;          // in the shaft: nobody can reach it there\n',
    to:   '',
  },
  {
    name: '#86a a spider drops out of the shaft',
    file: F('ship.js'),
    from: '    if (sp._climb) return;               // it cannot drop out of a lift shaft\n',
    to:   '',
  },
  {
    name: '#86a every pest is drawn everywhere',
    file: F('pests.js'),
    from: '    if (ship.pestVisible && !ship.pestVisible(this.roomId) &&',
    to:   '    if (false &&',
  },
  {
    name: '#86a a climbing pest is seen from nowhere',
    file: F('pests.js'),
    from: '        !(this._climb && ship.pestVisible(this._climb.to))) return;',
    to:   '        true) return;',
  },
  {
    name: '#86a a boarder of theirs sees for you',
    file: F('ship.js'),
    from: '    return this.crew.some(c => c && (c.isPlayer || c.isPet) && c.alive && !c.frozen &&',
    to:   '    return this.crew.some(c => c && c.alive && !c.frozen &&',
  },
  {
    name: '#86a the cat sees nothing',
    file: F('ship.js'),
    from: '    return this.crew.some(c => c && (c.isPlayer || c.isPet) && c.alive && !c.frozen &&',
    to:   '    return this.crew.some(c => c && c.isPlayer && !c.isPet && c.alive && !c.frozen &&',
  },
  {
    name: '#86a a man in a slab sees',
    file: F('ship.js'),
    from: '(c.isPlayer || c.isPet) && c.alive && !c.frozen &&',
    to:   '(c.isPlayer || c.isPet) && c.alive &&',
  },
  {
    name: '#86a egg cases are drawn everywhere',
    file: F('ship.js'),
    from: '      if (!this.pestVisible(egg.meta.roomId)) return;\n',
    to:   '',
  },
  {
    name: '#86a the rat walks tail first again',
    file: F('animation.js'),
    browser: true,
    from: '         about direction. */\n      ctx.scale(-1, 1);\n      if (mode === \'fight\') ctx.rotate(-0.16 * step);',
    to:   '         about direction. */\n      if (mode === \'fight\') ctx.rotate(-0.16 * step);',
  },
  {
    name: '#86a the climb is drawn flat',
    file: F('pests.js'),
    from: '      ctx.rotate(c.y1 < c.y0 ? -Math.PI / 2 : Math.PI / 2);\n',
    to:   '',
  },
  {
    name: '#86a a climbing rat is painted under the shaft',
    file: F('ship.js'),
    from: '    this.pests.forEach(p => { if (!p._climb) p.draw(ctx, this); });',
    to:   '    this.pests.forEach(p => p.draw(ctx, this));',
  },
  {
    name: '#86b a short supply comes out of the duct first',
    file: F('oxygen.js'),
    from: '      const fromRoom = Math.min(-amount, this.level);',
    to:   '      const fromRoom = Math.max(0, -amount - this.duct / T);',
  },
  {
    name: '#86b no air at all takes the duct first as well',
    file: F('oxygen.js'),
    from: '    if (amount < 0 && !flowing) {',
    to:   '    if (false) {',
  },
  {
    name: '#86b the manager never says nothing is flowing',
    file: F('oxygen.js'),
    from: '      ro.update(dt, share, breaches, room.isVacuum ?? false, crew, production > 0,',
    to:   '      ro.update(dt, share, breaches, room.isVacuum ?? false, crew, true,',
  },
  {
    name: '#86b the even split ignores the duct volume',
    file: F('oxygen.js'),
    from: '      const f = -amount / (1 + 1 / T);',
    to:   '      const f = -amount;',
  },
  {
    name: '#86b a rat has no breath to hold',
    file: F('ship.js'),
    // Re-aimed in update90: "dry" is a wisp below ROOM_EMPTY, not 0.
    from: '      } else if (dry && (p.air = Math.max(0, (p.air ?? T.AIR_SECONDS) - dt)) <= 0 &&',
    to:   '      } else if (dry &&',
  },
  {
    name: '#86b a rat never gets its breath back',
    file: F('ship.js'),
    from: '        p.air = Math.min(T.AIR_SECONDS, (p.air ?? T.AIR_SECONDS) + SUIT_AIR.REFILL_PER_SEC * dt);\n',
    to:   '',
  },
  {
    name: '#86b only the breeding rat litters',
    file: F('ship.js'),
    from: '    if (rat.level >= 2) this._ratLitter(rat);',
    to:   '    if (rat.level === 2) this._ratLitter(rat);',
  },
  {
    name: '#86b the yard fumigates again',
    file: F('game.js'),
    from: '       the cat\'s job, or the air\'s — not the dock\'s. */\n',
    to:   '       the cat\'s job, or the air\'s — not the dock\'s. */\n    if (_playerShip) _playerShip.pests = [];\n',
  },
  {
    name: '#87 player hulls fly one-pip life support again',
    file: F('ship.js'),
    from: 'systemLevels: { oxygen: 2, weapons: 2, engines: 2 },\n    startWeapons: [\'laser_basic\'],\n    reactorLevel: 6,',
    to:   'systemLevels: { weapons: 2, engines: 2 },\n    startWeapons: [\'laser_basic\'],\n    reactorLevel: 6,',
  },
  {
    name: '#87 an old hull keeps its one-pip O2',
    file: F('ship.js'),
    from: '      if (sys.type === \'oxygen\' && sys.level < Ship.O2_MIN_LEVEL) sys.level = Ship.O2_MIN_LEVEL;\n',
    to:   '',
  },
  {
    name: '#87 enemies are never sized for their crew',
    file: F('game.js'),
    from: '    _enemyShip.sizeAirForCrew(crewN);',
    to:   '',
  },
  {
    name: '#87 a boss gets no extra air',
    file: F('boss.js'),
    from: '    this._ship.sizeAirForCrew(crew.length, { boss: true });',
    to:   '',
  },
  {
    name: '#87 air sizing ignores the headcount',
    file: F('ship.js'),
    from: '    const want = Utils.clamp(Math.ceil(crewN / 3), boss ? 3 : Ship.O2_MIN_LEVEL, 4);',
    to:   '    const want = Ship.O2_MIN_LEVEL;',
  },
  {
    name: '#87 bought air is never powered',
    file: F('ship.js'),
    from: '    if (extra) {\n      this.reactor.maxLevel = Math.max(this.reactor.maxLevel, need);',
    to:   '    if (false) {\n      this.reactor.maxLevel = Math.max(this.reactor.maxLevel, need);',
  },
  {
    name: '#87 enemy air sized before the captives\' bay',
    file: F('game.js'),
    from: '    _enemyShip.assignStations();\n    _seatCaptives();\n    /* Air for the people aboard, and the power to run it (update87) —\n       LAST, after the captives: their carbonite bay is fitted in\n       `_seatCaptives`, and sizing before it left a raider carrying\n       prisoners one pip short (it was, before this package, too). */\n    _enemyShip.sizeAirForCrew(crewN);',
    to:   '    _enemyShip.sizeAirForCrew(crewN);\n    _enemyShip.assignStations();\n    _seatCaptives();',
  },
  {
    name: '#87 ports stock no medkits',
    file: F('station.js'),
    from: '      medkits: ri(1, 4 + Math.floor(s / 2)),',
    to:   '      medkits: 0,',
  },
  {
    name: '#87 a medkit is charged before it fits',
    file: F('station.js'),
    from: '    if (fits <= 0) return { ok: false, message: \'No room in the hold.\' };\n    const cost = this.medkitCost(fits);',
    to:   '    const cost = this.medkitCost(want);\n    if (fits <= 0) { Save.updateRun({ scrap: run.scrap - cost }); return { ok: false, message: \'No room in the hold.\' }; }',
  },
  {
    name: '#87 laser bolts fly slow again',
    file: F('weapons.js'),
    from: '    projectileSpeed: 320, missileUse: 0,\n    fireChance: 0.06,',
    to:   '    projectileSpeed: 240, missileUse: 0,\n    fireChance: 0.06,',
  },
  {
    name: '#87 the burst laser fires three',
    file: F('weapons.js'),
    from: '    powerCost: 2, chargeTime: 10, shots: 2, burstGap: 0.42,',
    to:   '    powerCost: 2, chargeTime: 14, shots: 3, burstGap: 0.42,',
  },
  {
    name: '#87 fire spreads at the old pace',
    file: F('fire.js'),
    from: '  SPREAD_TIME:    20.0,',
    to:   '  SPREAD_TIME:    12.0,',
  },
  {
    name: '#87 fire burns a man at the old rate',
    file: F('fire.js'),
    from: '  CREW_DAMAGE:    1.8,',
    to:   '  CREW_DAMAGE:    3.0,',
  },
  {
    name: '#87 a hungry man eats at once again',
    file: F('ship.js'),
    from: '      if (c.hunger <= 0 && !c.busy && !c.isPet && !c.down',
    to:   '      if (c.hunger < H.HUNGRY && !c.busy && !c.isPet && !c.down',
  },
  {
    name: '#87 a meal is three seconds again',
    file: F('crew.js'),
    from: '  EAT_SECONDS: 6,',
    to:   '  EAT_SECONDS: 3,',
  },
  {
    name: '#87 a bandage takes as long as a meal',
    file: F('ship.js'),
    from: '      : Ship.AID_SECONDS;\n    who._busyT',
    to:   '      : ((typeof HUNGER !== \'undefined\') ? HUNGER.EAT_SECONDS : 6);\n    who._busyT',
  },
  {
    name: '#87 hungry and eating side by side',
    file: F('renderer.js'),
    from: '    if (typeof HUNGER !== \'undefined\' && !(c.busy && c._busyAct === \'eat\')) {',
    to:   '    if (typeof HUNGER !== \'undefined\') {',
  },
  {
    name: '#87 a rolled Terra is on a hundred',
    file: F('crew.js'),
    from: '    const frame = CORP_DEFS[this.race]?.maxHp ?? 100;',
    to:   '    const frame = CORP_DEFS[cfg.race]?.maxHp ?? 100;',
  },
  {
    name: '#87 a Terra from an old save keeps his hundred',
    file: F('crew.js'),
    from: '    if (!this.isPet && CORP_DEFS[this.race]?.maxHp && this.baseMaxHp > frame) {',
    to:   '    if (false) {',
  },
  {
    name: '#87 the commander\'s bonus is lost with the old frame',
    file: F('crew.js'),
    from: '      this.maxHp = Math.round(this.maxHp * k);',
    to:   '      this.maxHp = frame;',
  },
  {
    name: '#87 no pip for a cyborg at the reactor',
    file: F('systems.js'),
    // Re-aimed in update99 (the Was drain) and update101 (the Djed boost).
    from: "         + this.cyborgBonus + (this.boost || 0);\n  }\n\n  /** Live output",
    to:   "         + (this.boost || 0);\n  }\n\n  /** Live output",
  },
  {
    name: '#87 a wrecked core keeps the cyborg pip',
    file: F('systems.js'),
    from: '    return (s && s.hasCyborg && s.workingLevels > 0) ? 1 : 0;',
    to:   '    return (s && s.hasCyborg) ? 1 : 0;',
  },
  {
    name: '#87 a charging gun cannot be aimed',
    file: F('game.js'),
    from: '        if (w && !aimWhy && !w.armed) {',
    to:   '        if (false) {',
  },
  {
    name: '#87 the aim of a charging gun is not kept',
    file: F('game.js'),
    from: '        _selectedWeapon.queuedShot = true;\n',
    to:   '',
  },
  {
    name: '#87 a queued shot never fires',
    file: F('game.js'),
    from: '      if (!w || !w.queuedShot || !w.armed) return;',
    to:   '      if (true) return;',
  },
  {
    name: '#87 a queued shot fires every frame',
    file: F('game.js'),
    from: '      w.queuedShot = false;\n      const target = w.targetRoom',
    to:   '      const target = w.targetRoom',
  },
  {
    name: '#87 the lifts are as fast as ever',
    file: F('elevator.js'),
    from: '  static get CABIN_SPEED() { return 55; }',
    to:   '  static get CABIN_SPEED() { return 80; }',
  },
  {
    name: '#87 an empty cannon can be aimed',
    file: F('combat.js'),
    from: '       it found out. */\n    return this._ammoRefusal(weapon);',
    to:   '       it found out. */\n    return null;',
  },
  {
    name: '#88 notices are not kept in the log',
    file: F('ui.js'),
    from: '    _log.push({ message: String(message ?? \'\'), type, fresh: LOG_FRESH });',
    to:   '    // (no log)',
  },
  {
    name: '#88 the log grows without end',
    file: F('ui.js'),
    from: '    if (_log.length > LOG_KEEP) _log.splice(0, _log.length - LOG_KEEP);',
    to:   '',
  },
  {
    name: '#88 the log window is never drawn',
    file: F('ui.js'),
    // Re-aimed in update90a: the log branch was rewritten.
    from: '      drawLogPanel(ctx);\n      _notifs.length = 0;',
    to:   '      _notifs.length = 0;',
  },

  {
    name: '#88 notices pop up under the open log too',
    file: F('ui.js'),
    // Re-aimed in update90a.
    from: '      _notifs.length = 0;             // already in the log — not queued up for later',
    to:   '      _drawNotifs(ctx, W);',
  },

  {
    name: '#90a a shut log pops them up in the middle again',
    file: F('ui.js'),
    // Re-aimed in update90a: shut, the log now swallows them — the player's ask; this is the old pop-up.
    from: '    if (state?.logPanel) {\n      drawLogPanel(ctx);',
    to:   '    if (state?.logPanel) {\n      if (!_logOpen) _drawNotifs(ctx, W);\n      drawLogPanel(ctx);',
  },

  {
    name: '#88 the game never asks for the log panel',
    file: F('game.js'),
    // Re-aimed in update90a: the map asks for it too.
    from: '                     logPanel: STATE === \'combat\' || STATE === \'map\',',
    to:   '                     logPanel: false,',
  },

  {
    name: '#88 the log tab does not take the click',
    file: F('game.js'),
    from: '    if (STATE === \'combat\' && UI.logClick?.(mx, my)) return true;',
    to:   '',
  },
  {
    name: '#88 L does nothing',
    file: F('game.js'),
    from: '    if (Input.isPressed(\'KeyL\')) UI.toggleLog();      // the log window (update88)',
    to:   '',
  },
  {
    name: '#88 the log shows the oldest lines',
    file: F('ui.js'),
    from: '    for (let i = _log.length - 1; i >= 0; i--) {\n      const e = _log[i];',
    to:   '    for (let i = 0; i < _log.length; i++) {\n      const e = _log[i];',
  },
  {
    name: '#88 the module icon is always the glyph',
    file: F('renderer.js'),
    from: '    const art = (typeof Assets !== \'undefined\' && Assets.source?.(key) === \'file\') ? Assets.get(key) : null;',
    to:   '    const art = null;',
  },
  {
    name: '#88 the icon leaves the text left-aligned',
    file: F('renderer.js'),
    from: '       before, on both paths. */\n    ctx.textAlign = \'center\';',
    to:   '       before, on both paths. */',
  },
  {
    name: '#88 the power bar goes back to its own glyph',
    file: F('renderer.js'),
    // Re-aimed in update90a: the colour rule moved to moduleIconState.
    from: '      drawSystemIcon(ctx, sys.type, ix, cy, iconR * 1.7,\n                     broken ?',
    to:   '      ctx.fillStyle = \'#fff\'; if (false) drawSystemIcon(ctx, sys.type, ix, cy, iconR * 1.7,\n                     broken ?',
  },

  {
    name: '#88 the picture in the middle of the room is back',
    file: F('systems.js'),
    from: '    // ── Module badge: WHAT it is, in its corner ──',
    to:   '    { const icon = Assets.get(this.icon); if (icon) ctx.drawImage(icon, this.cx - 13, this.cy - 17, 26, 26); }\n    // ── Module badge: WHAT it is, in its corner ──',
  },
  {
    name: '#88 the room corner has no icon',
    file: F('systems.js'),
    // Re-aimed in update90a: the badge is placed by badgeRect().
    from: '      Renderer.drawSystemIcon(ctx, this.type, bg.x + bg.w / 2, bg.y + bg.h / 2, 18,',
    to:   '      if (false) Renderer.drawSystemIcon(ctx, this.type, bg.x + bg.w / 2, bg.y + bg.h / 2, 18,',
  },

  {
    name: '#88 the air figure hides at full',
    file: F('oxygen.js'),
    // update120: the figure is four lamps now — the same promise, kept by them
    from: '    const lit = OXYGEN_LAMPS.litFor(this.level);',
    to:   '    if (this.level >= OXYGEN.MAX * 0.95) return;\n    const lit = OXYGEN_LAMPS.litFor(this.level);',
  },
  {
    name: '#88 the air figure goes back to the middle',
    file: F('oxygen.js'),
    from: '    const x0 = x + w - L.right;',
    to:   '    const x0 = x + w / 2;',
  },
  {
    name: '#88 the deck health is a bar again',
    file: F('crew.js'),
    from: '      if (typeof Renderer !== \'undefined\' && Renderer.drawPips) {',
    to:   '      if (false) {',
  },
  {
    name: '#88 no module tips',
    file: F('ui.js'),
    from: '    } else if (state?.moduleTips && state.playerShip) {',
    to:   '    } else if (false) {',
  },
  {
    name: '#88 the game never turns module tips on',
    file: F('game.js'),
    from: '                     moduleTips: STATE === \'combat\' || (STATE === \'map\' && _mapView === \'ship\') });',
    to:   '                     moduleTips: false });',
  },
  {
    name: '#88 the medbay tip reads the installed level',
    file: F('ship.js'),
    from: '        const ward = this.wardLevel();\n        const C = Ship.CURE_LEVELS;',
    to:   '        const ward = sys.level;\n        const C = Ship.CURE_LEVELS;',
  },
  {
    name: '#88 the O2 tip types its own number',
    file: F('ship.js'),
    from: '        const per = OXYGEN.PER_POWER / OXYGEN.BREATHING;',
    to:   '        const per = 4;',
  },
  {
    name: '#88 evasion keeps its own engine number',
    file: F('ship.js'),
    from: '    const engPct   = eng   ? eng.effectivePower()   * Ship.EVADE_ENGINE : 0;',
    to:   '    const engPct   = eng   ? eng.effectivePower()   * 0.025 : 0;',
  },
  {
    name: '#88 no double click',
    file: F('lootscreen.js'),
    from: '          _clock - _lastPick.t <= DOUBLE_CLICK && _onHome(mx, my)) {',
    to:   '          false) {',
  },
  {
    name: '#88 a slow second click counts as a double',
    file: F('lootscreen.js'),
    from: '          _clock - _lastPick.t <= DOUBLE_CLICK && _onHome(mx, my)) {',
    to:   '          _onHome(mx, my)) {',
  },
  {
    name: '#88 the clock never runs',
    file: F('lootscreen.js'),
    from: '    _clock += dt;\n',
    to:   '',
  },
  {
    name: '#88 a full side loses the crate',
    file: F('lootscreen.js'),
    from: '    _returnCarried();\n    _say(\'No room on the other side\', false);',
    to:   '    _carry = null;\n    _say(\'No room on the other side\', false);',
  },
  {
    name: '#88 the hold panel names no gun',
    file: F('lootscreen.js'),
    from: '    const gun = (it.def.kind === \'weapon\' && typeof WEAPON_DEFS !== \'undefined\')\n      ? WEAPON_DEFS[it.meta] : null;',
    to:   '    const gun = null;',
  },
  {
    name: '#88 the gun is not named in the title',
    file: F('lootscreen.js'),
    from: '    ctx.fillText(it.label + (gunIn && gunIn.label !== it.label ? ` — ${gunIn.label}` : \'\')',
    to:   '    ctx.fillText(it.label + \'\'',
  },
  {
    name: '#88 the crates talk about a weapon rack again',
    file: F('cargo.js'),
    from: '    desc: \'A salvaged weapon, boxed. UNBOX & FIT puts it on a free weapon mount.\',',
    to:   '    desc: \'A salvaged weapon. Unpack to move it to the weapon rack.\',',
  },
  {
    name: '#89 every rat has the same metabolism',
    file: F('pests.js'),
    from: '      this.metab    = cfg.metab ?? Utils.randFloat(RAT_TUNING.METAB_MIN, RAT_TUNING.METAB_MAX);',
    to:   '      this.metab    = cfg.metab ?? 1;',
  },
  {
    name: '#89 metabolism is ignored',
    file: F('ship.js'),
    from: '    rat.fullness = Math.max(0, (rat.fullness ?? 100) - T.HUNGER_PER_SEC * (rat.metab ?? 1) * dt);',
    to:   '    rat.fullness = Math.max(0, (rat.fullness ?? 100) - T.HUNGER_PER_SEC * dt);',
  },
  {
    name: '#89 the save forgets metabolism',
    file: F('pests.js'),
    from: '      ...(this.isRat ? { level: this.level, fullness: this.fullness, metab: this.metab } : {}),',
    to:   '      ...(this.isRat ? { level: this.level, fullness: this.fullness } : {}),',
  },
  {
    name: '#89 a litter shares one stomach',
    file: F('ship.js'),
    from: '        fullness: Utils.randFloat(T.PUP_FULL_MIN, 100),',
    to:   '        fullness: 100,',
  },
  {
    name: '#89 an adult always drops when it can',
    file: F('ship.js'),
    from: '    if (below.length && this._ratAngry(rat) && Math.random() < T.DROP_SHARE) {',
    to:   '    if (below.length && this._ratAngry(rat)) {',
  },
  {
    name: '#89 an adult never drops',
    file: F('ship.js'),
    from: '    if (below.length && this._ratAngry(rat) && Math.random() < T.DROP_SHARE) {',
    to:   '    if (false) {',
  },
  {
    name: '#89 the drop never misses',
    file: F('ship.js'),
    from: '          if (Math.random() >= PEST_TUNING.BITE_HIT) {',
    to:   '          if (false) {',
  },
  {
    name: '#89 the drop always misses',
    file: F('ship.js'),
    from: '          if (Math.random() >= PEST_TUNING.BITE_HIT) {',
    to:   '          if (true) {',
  },
  {
    name: '#89 no shorts',
    file: F('ship.js'),
    from: '    if (rat.level === 2 && hungryForWire) this._ratShort(rat, dt);',
    to:   '    if (false) this._ratShort(rat, dt);',
  },
  {
    name: '#89 a short out of a fight',
    file: F('ship.js'),
    from: '    if (!fighting || !sys || sys.stunLeft > 0) return false;',
    to:   '    if (!sys || sys.stunLeft > 0) return false;',
  },
  {
    name: '#89 a short with food aboard',
    file: F('ship.js'),
    from: '    if (rat.level === 2 && hungryForWire) this._ratShort(rat, dt);',
    to:   '    if (rat.level === 2) this._ratShort(rat, dt);',
  },
  {
    name: '#89 a short says nothing',
    file: F('ship.js'),
    from: '      UI.notify(`Something shorted the ${sys.label} loom — it is dead for ${T.SHORT_SECONDS}s!`, \'alert\');',
    to:   '',
  },
  {
    name: '#89 a short is a chew',
    file: F('ship.js'),
    from: '    sys.ionHit(T.SHORT_SECONDS, sys.level);',
    to:   '    sys.damageLevel?.(1); sys.ionHit(T.SHORT_SECONDS, sys.level);',
  },
  {
    name: '#89 no rat wrecks',
    file: F('wreck.js'),
    from: '  return Math.random() < RAT_WRECK_SHARE ? \'rat\' : \'spider\';',
    to:   '  return \'spider\';',
  },
  {
    name: '#89 every wreck is a rat wreck',
    file: F('wreck.js'),
    from: '  return Math.random() < RAT_WRECK_SHARE ? \'rat\' : \'spider\';',
    to:   '  return \'rat\';',
  },
  {
    name: '#89 a rat wreck gets spiders',
    file: F('wreck.js'),
    from: '  if (kind === \'rat\') {\n    const n',
    to:   '  if (false) {\n    const n',
  },
  {
    name: '#89 wreck rats are fed',
    file: F('wreck.js'),
    from: '      fullness: Utils.randFloat(10, 30),          // the wreck has been picked clean',
    to:   '      fullness: 100,',
  },
  {
    name: '#89 the boarding ignores the nest kind',
    file: F('game.js'),
    from: '    populateDerelict(_enemyShip, sector, nest);',
    to:   '    populateDerelict(_enemyShip, sector);',
  },
  {
    name: '#89 the dock does not say rats',
    file: F('game.js'),
    from: '    UI.notify(nest === \'rat\'\n',
    to:   '    UI.notify(false\n',
  },
  {
    name: '#89 a lean hold is not lean',
    file: F('cargo.js'),
    from: '  const tries = lean ? Math.max(1, rolled - 1) : rolled;',
    to:   '  const tries = rolled;',
  },
  {
    name: '#89 the duct bleeds with no hole',
    file: F('oxygen.js'),
    from: '    if (leaking && this.duct != null && this.level <= OXYGEN.ROOM_EMPTY) {',
    to:   '    if (this.duct != null && this.level <= OXYGEN.ROOM_EMPTY) {',
  },
  {
    name: '#89 a leak does not cross an open door',
    file: F('oxygen.js'),
    from: '        if (other && !out.has(other)) { out.add(other); queue.push(other); }',
    to:   '',
  },
  {
    name: '#89 a shut door leaks',
    file: F('oxygen.js'),
    from: '    const open = (ship.doors ?? []).filter(d => d.open && d.roomA && d.roomB);',
    to:   '    const open = (ship.doors ?? []).filter(d => d.roomA && d.roomB);',
  },
  {
    name: '#89 the preview runs the ducts',
    file: F('ship.js'),
    from: '    if (live) this.pestTick(dt);',
    to:   '    this.pestTick(dt);',
  },
  {
    name: '#89 the preview runs the egg clock',
    file: F('ship.js'),
    from: '    if (live) this.infectionTick(dt);',
    to:   '    this.infectionTick(dt);',
  },
  {
    name: '#89 the preview gets hungry',
    file: F('ship.js'),
    from: '    if (live) this.hungerTick(dt);',
    to:   '    this.hungerTick(dt);',
  },
  {
    name: '#89 the hangar picture is a live ship',
    file: F('basescreen.js'),
    from: '      sh.isPreview = true;                  // a picture: no clocks, no notices (update89)\n',
    to:   '',
  },
  {
    name: '#89 the launch throws the egg case out',
    file: F('game.js'),
    from: '      _playerShip.cargo = _launchHold(_playerShip.cargo, CargoGrid.deserialise(loadout.hold));',
    to:   '      _playerShip.cargo = CargoGrid.deserialise(loadout.hold);',
  },
  {
    name: '#89 the case is carried but not packed',
    file: F('game.js'),
    from: '    kept.forEach(it => fresh.autoPlace(it));\n',
    to:   '',
  },
  {
    name: '#90 the vent network never runs',
    file: F('oxygen.js'),
    from: '    this._ventNetwork(dt, ship);\n\n    const leaking',
    to:   '\n    const leaking',
  },
  {
    name: '#90 no duct is linked to another',
    file: F('oxygen.js'),
    from: '    ship._ventPairs = out;\n    return out;',
    to:   '    ship._ventPairs = [];\n    return [];',
  },
  {
    name: '#90 the lift shafts are off the network',
    file: F('oxygen.js'),
    from: '      return [`shaft_${sh.id}`, on.map(r => r.id)];',
    to:   '      return [`shaft_${sh.id}`, []];',
  },
  {
    name: '#90 the grille is shut',
    file: F('oxygen.js'),
    from: '    if (r.level <= d.duct) return;\n',
    to:   '    return;\n',
  },
  {
    name: '#90 the grille runs past level',
    file: F('oxygen.js'),
    from: 'Math.min((r.level - d.duct) * rate * dt, r.level - even)',
    to:   '(r.level - d.duct) * rate * dt',
  },
  {
    name: '#90 a duct link leaks air',
    file: F('oxygen.js'),
    from: '      b.duct += q;',
    to:   '      b.duct += q * 0.5;',
  },
  {
    name: '#90 the network back to a crawl — two pips hold a lock again',
    file: F('oxygen.js'),
    from: '  VENT_LINK:      0.6,',
    to:   '  VENT_LINK:      0.25,',
  },
  {
    name: '#90 the duct over a hole bleeds at the old rate',
    file: F('oxygen.js'),
    from: '  DUCT_BLEED:     1.5,',
    to:   '  DUCT_BLEED:     0.6,',
  },
  {
    name: '#90 the pumps feed a room open to space',
    file: F('oxygen.js'),
    from: '      if (r.isVacuum) return false;\n',
    to:   '',
  },
  {
    name: '#90 a man breathes a wisp',
    file: F('oxygen.js'),
    from: '      const breathable = this.level > OXYGEN.ROOM_EMPTY;',
    to:   '      const breathable = this.level > 0;',
  },
  {
    name: '#90 a rat breathes a wisp',
    file: F('ship.js'),
    from: '      const dry = ro && ro.duct <= OXYGEN.ROOM_EMPTY;',
    to:   '      const dry = ro && ro.duct <= 0;',
  },
  {
    name: '#90 a lift runs without power',
    file: F('elevator.js'),
    from: '  isUsable() { return !this.damaged && this.powered !== false; }',
    to:   '  isUsable() { return !this.damaged; }',
  },
  {
    name: '#90 the lifts are never given power',
    file: F('ship.js'),
    // Re-aimed in update90a: the power flow was rewritten.
    // Re-aimed in update98: the flow became Ship.reflowPower().
    from: '    this._powerLifts(total - drawn());     // update90: what is left lights the lifts\n',
    to:   '',
  },

  {
    name: '#90 lifts counted from the right',
    file: F('ship.js'),
    from: '    [...shafts].sort((a, b) => a.x - b.x).forEach(s => {',
    to:   '    [...shafts].sort((a, b) => b.x - a.x).forEach(s => {',
  },
  {
    name: '#90 lifts counted in list order',
    file: F('ship.js'),
    from: '    [...shafts].sort((a, b) => a.x - b.x).forEach(s => {',
    to:   '    [...shafts].forEach(s => {',
  },
  {
    name: '#90a a wreck\'s lifts run on nothing again',
    file: F('ship.js'),
    // Re-aimed in update90a: a wreck's lifts go by the ordinary rule now; this is the old exemption.
    from: '    const shafts = this.elevators?.shafts ?? [];\n    let left',
    to:   '    const shafts = this.elevators?.shafts ?? [];\n    if (this.isDerelict) { shafts.forEach(s => { s.powered = true; }); return; }\n    let left',
  },

  {
    name: '#90 the default split keeps nothing for the left lift',
    file: F('ship.js'),
    from: '    lift(1);\n    upTo(\'weapons\', 1);',
    to:   '    upTo(\'weapons\', 1);',
  },
  {
    name: '#90 the default split leaves the engines dark',
    file: F('ship.js'),
    from: '    upTo(\'engines\', 1);\n    lift(1);',
    to:   '    lift(1);',
  },
  {
    name: '#90 the constructor splits before there are lifts',
    file: F('ship.js'),
    from: '    /* The split above ran before there were any lifts to keep power for\n       (update90): now that there are, do it again. */\n    this._allocateDefaultPower();',
    to:   '',
  },
  {
    name: '#90 an enemy reactor is not sized for its lifts',
    file: F('ship.js'),
    from: '               + this.liftPowerNeed();      // update90: and a spare unit for each lift',
    to:   '               + 0;',
  },
  {
    name: '#90 an old save keeps its lifts dark',
    file: F('ship.js'),
    from: '    if (data.lifts == null) ship._reserveLiftPower();',
    to:   '',
  },
  {
    name: '#90 every save gets a unit taken back',
    file: F('ship.js'),
    from: '    if (data.lifts == null) ship._reserveLiftPower();',
    to:   '    ship._reserveLiftPower();',
  },
  {
    name: '#90 the save does not say it is from after 90',
    file: F('ship.js'),
    from: '      lifts: 1,\n',
    to:   '',
  },
  {
    name: '#90 the old save pays from the shields, not the guns',
    file: F('ship.js'),
    from: 'x.type === \'weapons\' ? -100',
    to:   'x.type === \'weapons\' ? 100',
  },
  {
    name: '#90 a dark cabin can be called',
    file: F('elevator.js'),
    // Re-aimed in update90a.
    from: '    if (this.powered === false) return false;\n',
    to:   '',
  },

  {
    name: '#90 anyone can board a dark lift',
    file: F('elevator.js'),
    from: '    if (!this.isUsable() || this.passenger) return false;',
    to:   '    if (this.damaged || this.passenger) return false;',
  },
  {
    name: '#90 a ride under way is dropped when the power goes',
    file: F('crew.js'),
    from: '      if (!shaft.isUsable() && !this._ridingShaft && !this._elevatorArrived) {',
    to:   '      if (!shaft.isUsable()) {',
  },
  {
    name: '#90 the arrival from a dark lift is dropped',
    file: F('crew.js'),
    from: '      if (!shaft.isUsable() && !this._ridingShaft && !this._elevatorArrived) {',
    to:   '      if (!shaft.isUsable() && !this._ridingShaft) {',
  },
  {
    name: '#90 a dark lift does not say so',
    file: F('elevator.js'),
    // Re-aimed in update90a.
    from: '      if (dark) {                        // stopped, between decks too (update90a)',
    to:   '      if (false) {',
  },

  {
    name: '#90 the reactor bar does not show the lifts\' units',
    file: F('renderer.js'),
    from: '      const lift    = lit && p >= ownFree - lifts;',
    to:   '      const lift    = false;',
  },
  {
    name: '#90a the last module powered is not remembered',
    file: F('ship.js'),
    from: '    if (sys.power > before) sys._powerStamp = (this._powerSeq = (this._powerSeq ?? 0) + 1);',
    to:   '',
  },
  {
    name: '#90a the reactor shrinking takes from the end of the list again',
    file: F('ship.js'),
    // Re-aimed in update98 (reflowPower, one indent less).
    // update127: the player's half of a ternary now (the enemy cuts by ENEMY_POWER_WANT)
    from: '      ? (((mods[b]._powerStamp ?? 0) - (mods[a]._powerStamp ?? 0)) || (b - a))',
    to:   '      ? ((b - a))',
  },
  {
    name: '#90a an unpowered module is red again',
    file: F('renderer.js'),
    from: '    if (sys.workingLevels <= 0 || (sys.ionDamage > 0 && sys.effectivePower() <= 0)) return \'broken\';',
    to:   '    if (sys.workingLevels <= 0 || sys.effectivePower() <= 0) return \'broken\';',
  },
  {
    name: '#90a a module on a cyborg alone looks switched off',
    file: F('renderer.js'),
    from: '    return sys.effectivePower() > 0 ? \'running\' : \'off\';',
    to:   '    return sys.power > 0 ? \'running\' : \'off\';',
  },
  {
    name: '#90a the cloak breathes again',
    file: F('ship.js'),
    from: '      ctx.globalAlpha = Ship.CLOAK_ALPHA;',
    to:   '      ctx.globalAlpha = 0.55 + Math.sin(performance.now() * 0.004) * 0.12;',
  },
  /* '#90a a cloaked hull does not say so' — retired in update127: jj asked for the label to go
     (it sat on the gun). Its opposite is '#127 the cloak label back'. */

  {
    name: '#90a the pod button goes back over JUMP',
    file: F('game.js'),
    from: '    return { x: c.x + c.w + 4, y: c.y, w: c.h, h: c.h };',
    to:   '    return { x: Renderer.getWidth() / 2 - 65, y: 102, w: 130, h: 26 };',
  },
  {
    name: '#90a the pod badge says nothing on hover',
    file: F('game.js'),
    from: '    if (hot) {\n      const k =',
    to:   '    if (false) {\n      const k =',
  },
  {
    name: '#90a the whole room brings up the module card',
    file: F('ui.js'),
    from: '      const b = r.system?.badgeRect?.();\n      return b && mx >= b.x',
    to:   '      const b = r.system ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;\n      return b && mx >= b.x',
  },
  {
    name: '#90a the map log covers the map',
    file: F('ui.js'),
    // Re-aimed in update91: logRect also keeps clear of the enemy strip.
    from: '    if (_logCompact) return LOG_RECT_COMPACT;',
    to:   '    if (false) return LOG_RECT_COMPACT;',
  },
  {
    name: '#90a a shut log counts nothing',
    file: F('ui.js'),
    from: '    if (!_logOpen) _unread++;\n',
    to:   '',
  },
  {
    name: '#90a L does nothing on the map',
    file: F('game.js'),
    from: '    if (Input.isPressed(\'KeyL\')) UI.toggleLog();\n    if (Input.mouse.leftPressed && UI.logClick',
    to:   '    if (Input.mouse.leftPressed && UI.logClick',
  },
  {
    name: '#90a he walks while he eats',
    file: F('crew.js'),
    // Re-aimed in update107 (the dose and the thaw joined the meal).
    from: '    if (this._busyT > 0 && (this._busyAct === \'eat\' || this._busyAct === \'heal\' || this._busyAct === \'thaw\')) {\n      if (this._waypoints.length',
    to:   '    if (this._busyT > 0 && (this._busyAct === \'heal\' || this._busyAct === \'thaw\')) {\n      if (this._waypoints.length',
  },
  {
    name: '#90a a dark lift carries on',
    file: F('elevator.js'),
    // Re-aimed in update90b: a shot-up cabin stops too.
    from: '    if (this._moving && (this.powered === false || this.damaged)) return;\n',
    to:   '',
  },
  {
    name: '#90a an order mid-ride assumes the cabin turned',
    file: F('crew.js'),
    from: '      if (stop !== -1 && shaft.moveCabinTo(stop)) {',
    to:   '      if (stop !== -1) { shaft.moveCabinTo(stop);',
  },
  {
    name: '#90a a stuck cabin shows an arrow, not OFF',
    file: F('elevator.js'),
    from: '      if (this._moving && !dark) {',
    to:   '      if (this._moving) {',
  },
  {
    name: '#90a a wreck has no engines',
    file: F('wreck.js'),
    from: '  if (eng) {\n    eng.damagedLevels = Math.max(0, eng.level - 1);',
    to:   '  if (false) {\n    eng.damagedLevels = Math.max(0, eng.level - 1);',
  },
  {
    name: '#90a a wreck keeps a single unit',
    file: F('wreck.js'),
    from: '    const half = Math.floor(ship.reactor.capacity / 2);',
    to:   '    const half = ship.reactor.capacity - 1;',
  },
  {
    name: '#90a an outpost seizes it too',
    file: F('station.js'),
    from: '    if (this.type === \'outpost\' || !ship?.cargo) return null;',
    to:   '    if (!ship?.cargo) return null;',
  },
  {
    name: '#90a the fine never touches the purse',
    file: F('station.js'),
    from: '    const paid = Math.min(purse, CUSTOMS_FINE);',
    to:   '    const paid = 0;',
  },
  {
    name: '#90a the shortfall takes the dearest thing aboard',
    file: F('station.js'),
    from: '      const pick = goods.find(g => g.v >= owed) ?? goods[goods.length - 1];',
    to:   '      const pick = goods[goods.length - 1];',
  },
  {
    name: '#90a nobody asks customs at the door',
    file: F('game.js'),
    from: '      _customs(_station);\n',
    to:   '',
  },
  {
    name: '#90b a shot-up cabin carries on',
    file: F('elevator.js'),
    from: '    if (this._moving && (this.powered === false || this.damaged)) return;\n',
    to:   '    if (this._moving && this.powered === false) return;\n',
  },
  {
    name: '#90b a boarder only ever eyes the five listed modules',
    file: F('crew.js'),
    from: '              .filter(r => r.id !== this.roomId && r.system && r.system.type !== \'reactor\' &&',
    to:   '              .filter(r => r.id !== this.roomId && r.system && [\'weapons\', \'shields\', \'piloting\', \'engines\', \'oxygen\'].includes(r.system.type) &&',
  },
  {
    name: '#90b a boarder waits on the first target, reachable or not',
    file: F('crew.js'),
    from: '              if (this.moveToOnShip(ship, t.cx, t.cy)) { went = true; break; }',
    to:   '              this.moveToOnShip(ship, t.cx, t.cy); went = true; break;',
  },
  {
    name: '#90b a boarder with nothing to break stands still',
    file: F('crew.js'),
    from: '            if (!went) {\n              const foes',
    to:   '            if (false) {\n              const foes',
  },
  {
    name: '#90b a boarder goes for the reactor too',
    file: F('crew.js'),
    from: 'r.system && r.system.type !== \'reactor\' &&',
    to:   'r.system &&',
  },
  {
    name: '#90b a stale commander hangs over a wreck',
    file: F('renderer.js'),
    from: 'foeShip.hull > 0 && !foeShip.isDerelict;',
    to:   'foeShip.hull > 0;',
  },
  {
    name: '#90b boarding a wreck keeps the last commander',
    file: F('game.js'),
    from: '    Commander?.setEnemy?.(null);\n    _enemyShip = makeDerelict(sector);',
    to:   '    _enemyShip = makeDerelict(sector);',
  },
  {
    name: '#90b the nebula lasts past the win',
    file: F('game.js'),
    from: '    if (_playerShip?.reactor) _playerShip.reactor.penalty = 0;\n    _nebulaCombat = false;\n    const reward',
    to:   '    const reward',
  },
  {
    name: '#90b every pest is worth the same to the cat',
    file: F('ship.js'),
    from: '      const food = Ship.preyFood(p);',
    to:   '      const food = HUNGER.FOOD.rat;',
  },
  {
    name: '#90b a fed cat still hunts',
    file: F('ship.js'),
    from: '      const live = (cat.hunger ?? 0) >= H.FED ? [] : this.pests.filter(p => p.alive);',
    to:   '      const live = this.pests.filter(p => p.alive);',
  },
  {
    name: '#90b a fed cat still goes up the duct',
    file: F('ship.js'),
    from: '      cat = this.crew.find(c => c && c.isPet && c.alive && !c.busy && !fed(c) &&',
    to:   '      cat = this.crew.find(c => c && c.isPet && c.alive && !c.busy &&',
  },
  {
    name: '#90b a fleet yard fumigates',
    file: F('station.js'),
    from: '    return !this.blackMarket && (this.type === \'general\' || this.type === \'science\');',
    to:   '    return !this.blackMarket;',
  },
  {
    name: '#90b fumigation is a flat price',
    file: F('station.js'),
    from: '    return n ? Station.FUMIGATE_BASE + Station.FUMIGATE_EACH * n : 0;',
    to:   '    return n ? Station.FUMIGATE_BASE : 0;',
  },
  {
    name: '#90b fumigation is free',
    file: F('station.js'),
    from: '    run.scrap -= cost;\n',
    to:   '',
  },
  {
    name: '#90b fumigation clears nothing',
    file: F('station.js'),
    from: '      if (vermin.includes(ship.pests[i])) ship.pests.splice(i, 1);',
    to:   '      if (false) ship.pests.splice(i, 1);',
  },
  {
    name: '#90b the station has no fumigation card',
    file: F('ui.js'),
    from: '          if (vermin.length) {\n            const here = s.offersFumigation;',
    to:   '          if (false) {\n            const here = s.offersFumigation;',
  },
  {
    name: '#90b a survivor has no speciality',
    file: F('wreck.js'),
    from: '    [spec]:  { level: MAX_SKILL_LEVEL, xp: 0 },',
    to:   '    [spec]:  { level: 1, xp: 0 },',
  },
  {
    name: '#90b a survivor bleeds out',
    file: F('wreck.js'),
    from: '  c._bandaged = true;\n  c._survivor = true;',
    to:   '  c._survivor = true;',
  },
  {
    name: '#90b no wreck has a survivor',
    file: F('game.js'),
    from: '    if (Math.random() < WRECK_SURVIVOR_SHARE) placeSurvivor',
    to:   '    if (false) placeSurvivor',
  },
  {
    name: '#90b a survivor lies in the docking room',
    file: F('game.js'),
    from: 'placeSurvivor(_enemyShip, _enemyShip.dockRoomId);',
    to:   'placeSurvivor(_enemyShip, null) && _enemyShip.crew.filter(c => c._survivor).forEach(c => { const d = _enemyShip.getRoomById(_enemyShip.dockRoomId); if (d) { c.roomId = d.id; c.x = d.cx; } });',
  },
  {
    name: '#90b nobody lifts the survivor',
    file: F('game.js'),
    from: '      s.carriedBy = bearer; bearer.carrying = s;',
    to:   '      return;',
  },
  {
    name: '#90b the survivor is never handed across',
    file: F('game.js'),
    from: '    if (b.roomId && b.roomId === _enemyShip.dockRoomId) _rescueSurvivor(s);',
    to:   '',
  },
  {
    name: '#90b the hulk does not wait for a carried survivor',
    file: F('game.js'),
    from: '_enemyShip.searchedAll() &&\n        !_survivorCarried()) {',
    to:   '_enemyShip.searchedAll()) {',
  },
  {
    name: '#90b a survivor nobody carried comes home anyway',
    file: F('game.js'),
    from: '        if (!c.dead && b && b.alive && b.isPlayer && b.carrying === c) _rescueSurvivor(c);',
    to:   '        if (!c.dead) _rescueSurvivor(c);',
  },
  {
    name: '#90b a survivor is carried to the wreck\'s medbay',
    file: F('ship.js'),
    from: '      if (body._survivor) return;\n',
    to:   '',
  },
  {
    name: '#90b the survivor is on our roster before he is aboard',
    file: F('renderer.js'),
    from: '    const away = (state.enemyShip?.crew ?? []).filter(c => c.isPlayer && !c._survivor);',
    to:   '    const away = (state.enemyShip?.crew ?? []).filter(c => c.isPlayer);',
  },
  {
    name: '#90b the survivor counts as our crew on the wreck',
    file: F('game.js'),
    from: '        c.isPlayer && !c._survivor && !c.dead && !c.dying).length;',
    to:   '        c.isPlayer && !c.dead && !c.dying).length;',
  },
  {
    name: '#90b a wreck rolls to escape',
    file: F('combat.js'),
    from: '    if (!this._escapeRolled && !this.enemyShip.isDerelict &&',
    to:   '    if (!this._escapeRolled &&',
  },
  {
    name: '#91 the cat comes aboard fed',
    file: F('game.js'),
    from: '      cat.hunger = Math.min(cat.hunger ?? 100, CAT_TUNING.START_HUNGER);\n',
    to:   '',
  },
  {
    name: '#91 a new cat is born fed',
    file: F('crew.js'),
    from: '    hunger: CAT_TUNING.START_HUNGER,\n  });',
    to:   '  });',
  },
  {
    name: '#91 gravity ignores the engines\' power',
    file: F('ship.js'),
    // Re-aimed in update104: the rule reads the reactor's unit (`fed`) now.
    from: '    return fed >= 1;',
    to:   '    return true;',
  },
  {
    name: '#91 gravity ignores the engines\' damage',
    file: F('ship.js'),
    // Re-aimed in update104.
    from: '    if (!e || e.workingLevels < 1) return false;\n    const fed = Math.min(e.power, e.workingLevels)',
    to:   '    if (!e) return false;\n    const fed = (e.power)',
  },
  {
    name: '#91 a ship with no engines has gravity',
    file: F('ship.js'),
    // Re-aimed in update104.
    from: '    if (!e || e.workingLevels < 1) return false;',
    to:   '    if (!e) return true;\n    if (e.workingLevels < 1) return false;',
  },
  {
    name: '#91 zero-G walks at full speed',
    file: F('ship.js'),
    from: '    return zg ? G.crewMovementMultiplier : 1;\n  }',
    to:   '    return 1;\n  }',
  },
  {
    name: '#91 carrying costs nothing',
    file: F('ship.js'),
    from: '    if (c?.carrying) return zg ? G.zeroGWoundedCarrySpeed : G.normalWoundedCarrySpeed;\n',
    to:   '',
  },
  {
    name: '#91 carrying in zero-G is as slow as in gravity',
    file: F('ship.js'),
    from: 'zg ? G.zeroGWoundedCarrySpeed : G.normalWoundedCarrySpeed',
    to:   'G.normalWoundedCarrySpeed',
  },
  {
    name: '#91 the walk ignores the ship',
    file: F('crew.js'),
    from: '                * (ship?.moveFactor ? ship.moveFactor(this) : 1);',
    to:   '                * 1;',
  },
  {
    name: '#91 zero-G repairs at full speed',
    file: F('crew.js'),
    from: '          room.repair(dt * (ship.repairFactor ? ship.repairFactor() : 1), this);',
    to:   '          room.repair(dt, this);',
  },
  {
    name: '#91 zero-G patches at full speed',
    file: F('crew.js'),
    from: '          breach.repair(dt * (ship.breachFactor ? ship.breachFactor() : 1), this);',
    to:   '          breach.repair(dt, this);',
  },
  {
    name: '#91 patching uses the repair penalty',
    file: F('ship.js'),
    from: '  breachFactor() { return this.zeroG ? GRAVITY_CONFIG.breachRepairMultiplier : 1; }',
    to:   '  breachFactor() { return this.zeroG ? GRAVITY_CONFIG.normalRepairMultiplier : 1; }',
  },
  {
    name: '#91 fire spreads as fast in zero-G',
    file: F('fire.js'),
    from: '          ? GRAVITY_CONFIG.fireSpreadMultiplier : 1;',
    to:   '          ? 1 : 1;',
  },
  {
    name: '#91 the fire is never told about zero-G',
    file: F('fire.js'),
    from: '      fire.zeroG = !!ship.zeroG;             // visual state only (update91)\n',
    to:   '',
  },
  {
    name: '#91 the zero-G flame is the old plume',
    file: F('fire.js'),
    from: '    if (this.zeroG) {\n      const t = (this.age ?? 0);',
    to:   '    if (false) {\n      const t = (this.age ?? 0);',
  },
  {
    name: '#91 gravity is never ticked',
    file: F('ship.js'),
    from: '    this._gravityTick(dt);\n',
    to:   '',
  },
  {
    name: '#91 every frame says GRAVITY LOST',
    file: F('ship.js'),
    from: '    if (on !== this._gravityWas) {\n      this._gravityWas = on;',
    to:   '    if (true) {\n      this._gravityWas = on;',
  },
  {
    name: '#91 a hull that starts in zero-G announces it',
    file: F('ship.js'),
    from: '    if (this._gravityWas === undefined) { this._gravityWas = on; return; }',
    to:   '    if (this._gravityWas === undefined) this._gravityWas = true;',
  },
  {
    name: '#91 the enemy\'s gravity is announced to us',
    file: F('ship.js'),
    from: '      if (this.isPlayer && typeof UI !== \'undefined\') {\n        UI.notify(on ? \'GRAVITY RESTORED\'',
    to:   '      if (typeof UI !== \'undefined\') {\n        UI.notify(on ? \'GRAVITY RESTORED\'',
  },
  {
    name: '#91 the hold is never at risk',
    file: F('ship.js'),
    from: '    if (!on && !this.isPreview) this._zeroGCargoTick(dt);',
    to:   '    ;',
  },
  {
    name: '#91 the damage roll is per frame',
    file: F('ship.js'),
    from: '    while (this._zgDamageT >= G.cargoDamageCheckInterval) {\n      this._zgDamageT -= G.cargoDamageCheckInterval;',
    to:   '    if (this._zgDamageT > 0) {\n      this._zgDamageT = 0;',
  },
  {
    name: '#91 the egg case can be damaged',
    file: F('ship.js'),
    from: '      const ok = hold.items.filter(it => !it.damaged && it.def?.tag !== \'egg\');',
    to:   '      const ok = hold.items.filter(it => !it.damaged);',
  },
  {
    name: '#91 damage removes the item',
    file: F('ship.js'),
    from: '      it.damaged = true;\n      say(`CARGO DAMAGED:',
    to:   '      hold.remove(it);\n      say(`CARGO DAMAGED:',
  },
  {
    name: '#91 zero-G loses cargo without a hole',
    file: F('ship.js'),
    from: '    if (!holed) { this._zgLossT = 0; return; }',
    to:   '    if (false) { this._zgLossT = 0; return; }',
  },
  {
    name: '#91 a loss takes the whole stack',
    file: F('ship.js'),
    from: '      if (it.isStack && it.qty > 1) it.qty -= 1;\n      else hold.remove(it);',
    to:   '      hold.remove(it);',
  },
  {
    name: '#91 a loss is not said',
    file: F('ship.js'),
    from: '      say(`CARGO LOST: ${it.label}`);',
    to:   '',
  },
  {
    name: '#91 the clocks run on after gravity returns',
    file: F('ship.js'),
    from: '      this._zgDamageT = 0; this._zgLossT = 0;\n      if (this.isPlayer',
    to:   '      if (this.isPlayer',
  },
  {
    name: '#91 the AI ignores zero-G',
    file: F('combat.js'),
    from: "    const rank = (s) => s.type === 'reactor' ? 0 : (enemy.zeroG && s.type === 'engines') ? 1 : 2;",
    to:   "    const rank = (s) => s.type === 'reactor' ? 0 : 2;",
  },
  {
    name: '#91 no GRAV ON / ZERO-G under the engines',
    file: F('renderer.js'),
    // Re-aimed in update130: layout B hides the names, so the line asks `names` first.
    from: '      if (names && sys.type === \'engines\' && sys === ship.getSystem(\'engines\')) {',
    to:   '      if (false) {',
  },
  {
    name: '#91 their zero-G is not marked',
    file: F('renderer.js'),
    from: '      if (sys.type === \'engines\' && ship.zeroG) {\n        ctx.fillStyle = \'#ff7c20\';',
    to:   '      if (false) {\n        ctx.fillStyle = \'#ff7c20\';',
  },
  {
    name: '#91 the engines card says nothing of gravity',
    file: F('ship.js'),
    from: '        row(this.gravityActive ? \'Gravity ON',
    to:   '        if (false) row(this.gravityActive ? \'Gravity ON',
  },
  {
    name: '#91 the crew do not float',
    file: F('ship.js'),
    from: '      if (zg && c && !c._ridingShaft && c._ductY == null) {',
    to:   '      if (false) {',
  },
  {
    name: '#91 the log window covers the enemy strip again',
    file: F('ui.js'),
    from: '    const top = Math.max(LOG_RECT.y, strip + 22);',
    to:   '    const top = LOG_RECT.y;',
  },
  {
    name: '#92 the lifts count as load',
    file: F('ship.js'),
    from: '    const used = this.systems.reduce((a, sys) => a + (sys.type === \'reactor\' ? 0 : sys.reactorDraw()), 0);',
    to:   '    const used = this.systems.reduce((a, sys) => a + (sys.type === \'reactor\' ? 0 : sys.reactorDraw()), 0) + this.liftsPowered();',
  },
  {
    name: '#92 the reactor never heats',
    file: F('ship.js'),
    from: '    if (up) {\n      const mult',
    to:   '    if (false) {\n      const mult',
  },
  {
    name: '#92 every band heats at the 100% rate',
    file: F('ship.js'),
    from: '    const up = H.heatBands.find(b => load >= b.load - eps);',
    to:   '    const up = load >= 0.8 - eps ? H.heatBands[0] : null;',
  },
  {
    name: '#92 heating from 70% load',
    file: F('ship.js'),
    from: '    { load: 0.80, perSec: 100 / 600 },  // 80–89%   → ~10 min',
    to:   '    { load: 0.70, perSec: 100 / 600 },  // 80–89%   → ~10 min',
  },
  {
    name: '#92 100% load heats like 90%',
    file: F('ship.js'),
    from: '    { load: 1.00, perSec: 100 / 180 },  // 100%     → full in ~3 min',
    to:   '    { load: 1.00, perSec: 100 / 360 },  // 100%     → full in ~3 min',
  },
  {
    name: '#92 the reactor never cools',
    file: F('ship.js'),
    from: '    return down ? -down.perSec : 0;',
    to:   '    return 0;',
  },
  {
    name: '#92 cooling only from 40% free',
    file: F('ship.js'),
    from: '    { free: 0.30, perSec: 100 / 600 },  // 30–39%    → ~10 min',
    to:   '    { free: 0.40, perSec: 100 / 600 },  // 30–39%    → ~10 min',
  },
  {
    name: '#92 a scrammed reactor keeps its heat',
    file: F('ship.js'),
    from: '    if (r.offline || r.totalPower <= 0) return -H.scramCoolPerSec;',
    to:   '    if (r.offline || r.totalPower <= 0) return 0;',
  },
  {
    name: '#92 no thermal multiplier',
    file: F('ship.js'),
    from: '      return up.perSec * mult;',
    to:   '      return up.perSec;',
  },
  {
    name: '#92 the heat is never ticked',
    file: F('ship.js'),
    from: '    this._heatTick(dt);\n',
    to:   '',
  },

  {
    name: '#92 an overheat costs nothing',
    file: F('ship.js'),
    from: '      if (sys) sys.damageLevel(H.overheatDamage);',
    to:   '      ;',
  },
  {
    name: '#92 an overheat resets to 0',
    file: F('ship.js'),
    from: '  overheatResetHeat: 90,',
    to:   '  overheatResetHeat: 0,',
  },
  {
    name: '#92 an overheat never lights the room',
    file: F('ship.js'),
    from: '        if (Math.random() < H.overheatFireChance) this.fires.start(room.id, room.cx, room.cy);',
    to:   '',
  },
  {
    name: '#92 the overheat is not said',
    file: F('ship.js'),
    from: '        if (typeof UI !== \'undefined\') UI.notify(\'☢ REACTOR OVERHEAT',
    to:   '        if (false) UI.notify(\'☢ REACTOR OVERHEAT',
  },
  {
    name: '#92 the fire roll is per frame',
    file: F('ship.js'),
    from: '    while (this._heatHazardT >= H.hazardInterval) {\n      this._heatHazardT -= H.hazardInterval;',
    to:   '    if (this._heatHazardT > 0) {\n      this._heatHazardT = 0;',
  },
  {
    name: '#92 heat never lights the reactor room',
    file: F('ship.js'),
    from: '      if (band && room && Math.random() < band.p) {',
    to:   '      if (false) {',
  },
  {
    name: '#92 the fire odds are all 2%',
    file: F('ship.js'),
    from: '      const band = H.fireChance.find(b => this.reactorHeat >= b.heat);',
    to:   '      const band = this.reactorHeat >= 70 ? H.fireChance[0] : null;',
  },
  {
    name: '#92 the warnings repeat every frame',
    file: F('ship.js'),
    from: '      } else if (before < H.warnHeat && heat >= H.warnHeat) {',
    to:   '      } else if (heat >= H.warnHeat) {',
  },
  {
    name: '#92 their heat is announced to us',
    file: F('ship.js'),
    from: '    if (this.isPlayer) {\n      if (before < H.criticalHeat',
    to:   '    if (true) {\n      if (before < H.criticalHeat',
  },
  {
    name: '#92 the heat is not saved',
    file: F('ship.js'),
    from: '      heat: Math.round(this.reactorHeat ?? 0),\n',
    to:   '',
  },
  {
    name: '#92 a load forgets the heat',
    file: F('ship.js'),
    from: '    ship.reactorHeat = Utils.clamp(data.heat ?? 0, 0, 100);   // an old save: cold\n',
    to:   '',
  },
  {
    name: '#92 the yard does not cool the hull',
    file: F('base.js'),
    from: '    if (shipEntry?.data) shipEntry.data.heat = 0;\n',
    to:   '',
  },
  {
    name: '#92 no heat bar',
    file: F('renderer.js'),
    from: '        ctx.fillRect(bx, bBot - fh, bw, fh);',
    to:   '',
  },
  {
    name: '#92 no heat figure',
    file: F('renderer.js'),
    // Re-anchored in update97 (degrees).
    from: '        ctx.fillText(`${heatCelsius(heat)}°C`, bx - 1, bTop - 3);',
    to:   '',
  },
  {
    name: '#92 no OVERHEAT on the bar',
    file: F('renderer.js'),
    from: '        if ((ship._overheatFlashT ?? 0) > 0) {',
    to:   '        if (false) {',
  },
  {
    name: '#92 the reactor card has no heat',
    file: F('ship.js'),
    // Re-anchored in update97 (degrees).
    from: '          row(`Core ${heatCelsius(heat)} °C of ${C} · load',
    to:   '          if (false) row(`Core ${heatCelsius(heat)} °C of ${C} · load',
  },
  {
    name: '#92 their hot reactor is not marked',
    file: F('renderer.js'),
    // Re-anchored in update97 (their core's temperature is always shown).
    from: "        ctx.fillText(`${heatCelsius(h)}°C`, ix, iy + 20);",
    to:   "        ;",
  },
  {
    name: "#93 their downed get no medkit",
    file: F("ship.js"),
    from: "      if (c.down && !ward && this.hasDoses(Ship.MEDKIT_DOSES)) c.bodyOrder = 'medkit';",
    to:   "      if (false) c.bodyOrder = 'medkit';",
  },
  {
    name: "#93 a medkit even with a lit ward",
    file: F("ship.js"),
    from: "      if (c.down && !ward && this.hasDoses(Ship.MEDKIT_DOSES)) c.bodyOrder = 'medkit';",
    to:   "      if (c.down && this.hasDoses(Ship.MEDKIT_DOSES)) c.bodyOrder = 'medkit';",
  },
  {
    name: "#93 a medkit order with no doses",
    file: F("ship.js"),
    from: "      if (c.down && !ward && this.hasDoses(Ship.MEDKIT_DOSES)) c.bodyOrder = 'medkit';",
    to:   "      if (c.down && !ward) c.bodyOrder = 'medkit';",
  },
  {
    name: "#93 the order stays when the box is dry",
    file: F("ship.js"),
    from: "      if (c.bodyOrder === 'medkit' && !this.hasDoses(Ship.MEDKIT_DOSES)) c.bodyOrder = null;",
    to:   "",
  },
  {
    name: "#93 their dead are never vented",
    file: F("ship.js"),
    from: "        if (!airlock || !(c.decaying || (c._rotT ?? 0) >= Ship.AI_VENT_SECONDS)) return;",
    to:   "        return;",
  },
  {
    name: "#93 their dead are vented the moment they fall",
    file: F("ship.js"),
    from: "        if (!airlock || !(c.decaying || (c._rotT ?? 0) >= Ship.AI_VENT_SECONDS)) return;",
    to:   "        if (!airlock) return;",
  },
  {
    name: "#93 a vent order with no airlock",
    file: F("ship.js"),
    from: "        if (!airlock || !(c.decaying || (c._rotT ?? 0) >= Ship.AI_VENT_SECONDS)) return;",
    to:   "        if (!(c.decaying || (c._rotT ?? 0) >= Ship.AI_VENT_SECONDS)) return;",
  },
  {
    name: "#93 the AI orders on the player ship",
    file: F("ship.js"),
    from: "    if (this.isPlayer || this.isDerelict || this.isPreview) return;\n    const own",
    to:   "    if (this.isDerelict || this.isPreview) return;\n    const own",
  },
  {
    name: "#93 the AI buries prisoners",
    file: F("ship.js"),
    from: "    const own = c => c && c.isPlayer === this.isPlayer && !c.isPet && !c.isPrisoner &&",
    to:   "    const own = c => c && c.isPlayer === this.isPlayer && !c.isPet &&",
  },
  {
    name: "#93 nobody gives the enemy orders",
    file: F("ship.js"),
    from: "    this._aiBodyOrders(dt);",
    to:   "",
  },
  {
    name: "#93 their dead on our deck cannot be clicked",
    file: F("game.js"),
    from: "      const theirDead = !c.isPlayer && !c.isPrisoner && !c.isPet && c.dead;",
    to:   "      const theirDead = false;",
  },
  {
    name: "#93 the living boarder is clickable too",
    file: F("game.js"),
    from: "      const theirDead = !c.isPlayer && !c.isPrisoner && !c.isPet && c.dead;",
    to:   "      const theirDead = !c.isPlayer && !c.isPrisoner && !c.isPet;",
  },
  {
    name: "#93 nobody picks up their vented dead",
    file: F("ship.js"),
    from: "          .filter(b => b.isPlayer === this.isPlayer || (b.dead && b.bodyOrder === 'eject'))",
    to:   "          .filter(b => b.isPlayer === this.isPlayer)",
  },
  {
    name: "#93 venting a boarder costs karma",
    file: F("ship.js"),
    from: "      if (this.isPlayer && c.isPlayer && c.dead && c.bodyOrder === 'eject' &&",
    to:   "      if (this.isPlayer && c.dead && c.bodyOrder === 'eject' &&",
  },
  {
    name: "#93 their body is announced as ours going out",
    file: F("ship.js"),
    from: "        UI.notify(c.dead ? (c.isPlayer === this.isPlayer ? `${c.name}'s body committed to space.`",
    to:   "        UI.notify(c.dead ? (true ? `${c.name}'s body committed to space.`",
  },
  {
    name: "#93 their rot is announced as ours",
    file: F("ship.js"),
    from: "      UI.notify(c.isPlayer === this.isPlayer\n        ? `${c.name}'s body is DECAYING",
    to:   "      UI.notify(true\n        ? `${c.name}'s body is DECAYING",
  },
  {
    name: "#93 their bag carries his name as one of ours",
    file: F("ship.js"),
    from: "    const theirs = body.isPlayer !== this.isPlayer;\n    const it = this.cargo.add",
    to:   "    const theirs = false;\n    const it = this.cargo.add",
  },
  {
    name: "#93 the dock pays for an unknown as a bounty",
    file: F("base.js"),
    from: "          if (it.meta?.enemyBody) {",
    to:   "          if (false) {",
  },
  {
    name: "#93 no karma for an unmarked grave",
    file: F("base.js"),
    from: "              Commander.shift(Commander.active(), Ship.UNKNOWN_BURIAL_KARMA);\n",
    to:   "",
  },
  {
    name: "#93 they never give up",
    file: F("combat.js"),
    from: "      if (this._noHarmT >= this.STALEMATE_SECONDS) {",
    to:   "      if (false) {",
  },
  {
    name: "#93 they give up after 30 s",
    file: F("combat.js"),
    from: "    this.STALEMATE_SECONDS  = 60;",
    to:   "    this.STALEMATE_SECONDS  = 30;",
  },
  {
    name: "#93 a hit does not reset the clock",
    file: F("combat.js"),
    from: "      if (seen !== this._harmSeen) { this._harmSeen = seen; this._noHarmT = 0; }",
    to:   "      if (seen !== this._harmSeen) { this._harmSeen = seen; }",
  },
  {
    name: "#93 the boss gives up too",
    file: F("combat.js"),
    from: "    if (this._ai !== AI_DEFS.boss && !this.enemyShip.isDerelict && !grounded && !this.enemyEscapeActive) {",
    to:   "    if (!this.enemyShip.isDerelict && !grounded && !this.enemyEscapeActive) {",
  },
  {
    name: "#93 the clock runs through a surrender offer",
    file: F("combat.js"),
    from: "      else if (!this.surrenderOffer) this._noHarmT += dt;",
    to:   "      else this._noHarmT += dt;",
  },
  {
    name: "#93 a stalemate run is reported as a hull run",
    file: F("combat.js"),
    from: "        this.escapeWhy         = 'stalemate';",
    to:   "        this.escapeWhy         = 'hull';",
  },
  {
    name: "#93 a landed shot is not harm",
    file: F("ship.js"),
    from: "        ((cd[1] ?? 0) > 0 && this.occupantsOf(roomHit.id).length > 0))) {\n      Ship.noteHarmToPlayer();",
    to:   "        ((cd[1] ?? 0) > 0 && this.occupantsOf(roomHit.id).length > 0))) {\n      0;",
  },
  {
    name: "#93 every landed bolt is harm",
    file: F("ship.js"),
    from: "        ((cd[1] ?? 0) > 0 && this.occupantsOf(roomHit.id).length > 0))) {",
    to:   "        true)) {",
  },
  {
    name: "#93 a blow on ours is not harm",
    file: F("crew.js"),
    from: "      Ship.noteHarmToPlayer?.();",
    to:   "      0;",
  },
  {
    name: "#93 our blow on them is harm",
    file: F("crew.js"),
    from: "    if (target.isPlayer && !this.isPlayer && !this.isPet && typeof Ship !== 'undefined') {",
    to:   "    if (!this.isPet && typeof Ship !== 'undefined') {",
  },
  {
    name: "#93 their captives sit outside the ice",
    file: F("game.js"),
    from: "      _enemyShip.freezeCaptive(c);\n",
    to:   "",
  },
  {
    name: "#93 a thawed captive is not announced",
    file: F("ship.js"),
    // Re-aimed in update107.
    from: "        if (typeof UI !== 'undefined') {\n          UI.notify(`A prisoner on their hull is out of the carbonite",
    to:   "        if (false) {\n          UI.notify(`A prisoner on their hull is out of the carbonite",
  },
  {
    name: "#93 the brawl does not form pairs",
    file: F("crew.js"),
    from: "          this.x += Utils.clamp(spot.x - this.x, -step, step);",
    to:   "          0;",
  },
  {
    name: "#93 ours on the right",
    file: F("crew.js"),
    from: "    const dir = this.isPlayer ? -1 : 1;          // ours left, theirs right",
    to:   "    const dir = this.isPlayer ? 1 : -1;",
  },
  {
    name: "#93 one pair for everybody",
    file: F("crew.js"),
    from: "    const P = Math.min(mine.length, them.length);",
    to:   "    const P = Math.min(1, mine.length, them.length);",
  },
  {
    name: "#93 the helpers stand on their mate",
    file: F("crew.js"),
    from: "    const x = Utils.clamp(cx + dir * (gap + rank * CrewMember.DUEL_BACK), L, L + U);",
    to:   "    const x = Utils.clamp(cx + dir * gap, L, L + U);",
  },
  {
    name: "#93 no tie under a pair",
    file: F("crew.js"),
    from: "    if (this._duel && this._duel.lead && this._duel.ours && !this.down) {",
    to:   "    if (false) {",
  },
  {
    name: "#93 a tie for every man",
    file: F("crew.js"),
    from: "    if (this._duel && this._duel.lead && this._duel.ours && !this.down) {",
    to:   "    if (this._duel && !this.down) {",
  },
  {
    name: "#93 the pair outlives the fight",
    file: F("crew.js"),
    from: "    this._duel = null;   // set again below, every frame he is in a fight",
    to:   "",
  },
  {
    name: "#93 the combat AI never touches its core",
    file: F("combat.js"),
    from: "    enemy.coolingAI?.(dt);",
    to:   "",
  },
  {
    name: "#93 the AI takes nothing off",
    file: F("ship.js"),
    from: "      x.desiredPower -= 1;\n      this._aiShed.push(x);",
    to:   "      this._aiShed.push(x);",
  },
  {
    name: "#93 the AI never gives it back",
    file: F("ship.js"),
    from: "    if (heat <= A.restoreAt && this._aiShed.length) {",
    to:   "    if (false) {",
  },
  {
    name: "#93 the AI starts with the helm",
    file: F("ship.js"),
    from: "    const order = ['medbay', 'cloaking', 'autorepair', 'engines', 'weapons', 'shields', 'oxygen'];",
    to:   "    const order = ['piloting', 'medbay', 'cloaking', 'autorepair', 'engines', 'weapons', 'shields', 'oxygen'];",
  },
  {
    name: "#93 the AI sheds the last gun",
    file: F("ship.js"),
    from: "        .filter(x => !(x.type === 'weapons' && guns.length <= 1));",
    to:   "",
  },
  {
    name: "#93 the AI sheds the engines to zero",
    file: F("ship.js"),
    // update127: rePowerAI has the same line — pinned to the shed pick's own
    from: "    const floor = (x) => x.type === 'engines' || x.type === 'oxygen' ? 1\n                       : x.type === 'shields' ? 2 : 0;\n    const guns",
    to:   "    const floor = (x) => x.type === 'oxygen' ? 1\n                       : x.type === 'shields' ? 2 : 0;\n    const guns",
  },
  {
    name: "#93 the AI waits for 90 degrees",
    file: F("ship.js"),
    from: "  ai: { shedAt: 75, restoreAt: 30, targetLoad: 0.70, stepSeconds: 1 },",
    to:   "  ai: { shedAt: 90, restoreAt: 30, targetLoad: 0.70, stepSeconds: 1 },",
  },
  {
    name: "#93 the AI sheds only to 80 percent",
    file: F("ship.js"),
    from: "  ai: { shedAt: 75, restoreAt: 30, targetLoad: 0.70, stepSeconds: 1 },",
    to:   "  ai: { shedAt: 75, restoreAt: 30, targetLoad: 0.80, stepSeconds: 1 },",
  },
  {
    name: "#93 the AI touches the player bar",
    file: F("ship.js"),
    from: "    if (this.isPlayer || this.isDerelict || !this.reactor) return;\n    const A = REACTOR_HEAT_CONFIG.ai;",
    to:   "    if (this.isDerelict || !this.reactor) return;\n    const A = REACTOR_HEAT_CONFIG.ai;",
  },
  {
    name: "#93 the AI acts at any heat",
    file: F("ship.js"),
    from: "    if (heat >= A.shedAt || (this._aiShed.length && heat > A.restoreAt &&",
    to:   "    if (true || (this._aiShed.length && heat > A.restoreAt &&",
  },
  {
    name: "#93a the dock plants no NN stake",
    file: F("base.js"),
    from: "            Save.addUnknownGrave?.();   // an NN stone on the hill (update93a)\n",
    to:   "",
  },
  {
    name: "#93a the NN stake is drawn as one of ours",
    file: F("basescreen.js"),
    from: "    if (g && g.enemy) { _drawEnemyGrave(ctx, x, y, hot); return; }\n",
    to:   "",
  },
  {
    name: "#93a the NN card is a crewman's card",
    file: F("basescreen.js"),
    from: "    if (g && g.enemy) {\n      const W = 220, H = 70;",
    to:   "    if (false) {\n      const W = 220, H = 70;",
  },
  {
    name: "#93a the hill counts theirs as ours",
    file: F("basescreen.js"),
    from: "    const ours = graves.filter(g => !g.enemy).length, nn = graves.length - ours;",
    to:   "    const ours = graves.length, nn = 0;",
  },
  {
    name: "#93a the NN grave is not buried",
    file: F("save.js"),
    from: "      buried: true,\n    };\n    _data.graveyard.push(rec);",
    to:   "      buried: false,\n    };\n    _data.graveyard.push(rec);",
  },
  {
    name: "#93a the last gunner carries the dead",
    file: F("ship.js"),
    from: "        k.roomId !== pilotRoom && k !== lastGunner && k !== near)",
    to:   "        k.roomId !== pilotRoom && k !== near)",
  },
  {
    name: "#93a the pilot carries the dead",
    file: F("ship.js"),
    from: "        k.roomId !== pilotRoom && k !== lastGunner && k !== near)",
    to:   "        k !== lastGunner && k !== near)",
  },
  {
    name: "#93a anybody in the room lifts their dead",
    file: F("ship.js"),
    from: "            if (b.dead) return b.bodyOrder === 'eject' && (this.isPlayer || c._rescueId === b.id);",
    to:   "            if (b.dead) return b.bodyOrder === 'eject';",
  },
  {
    name: "#93a the patch skill is squared again",
    file: F("crew.js"),
    from: "          breach.repair(dt * (ship.breachFactor ? ship.breachFactor() : 1), this);",
    to:   "          breach.repair(dt * this.breachSpeed() * (ship.breachFactor ? ship.breachFactor() : 1), this);",
  },
  {
    name: "#93a boarders walk in single file",
    file: F("crew.js"),
    from: "              .sort((a, b) => (claimed(a) - claimed(b)) || (rank(a) - rank(b)));",
    to:   "              .sort((a, b) => rank(a) - rank(b));",
  },
  {
    name: "#93a a won fight jumps to the map",
    file: F("game.js"),
    from: "    STATE = 'map';\n    _mapView = view;\n",
    to:   "    STATE = 'map';\n",
  },
  {
    name: "#93a the cyborg counts anywhere in the room",
    file: F("systems.js"),
    from: "    if (this.consoleCrew !== undefined) {",
    to:   "    if (false) {",
  },
  {
    name: "#93a his unit stays in the module he left",
    file: F("ship.js"),
    from: "        sys.desiredPower = Math.max(0, sys.desiredPower - 1);\n        sys.power = Math.min(sys.power, sys.desiredPower);",
    to:   "        void 0;",
  },
  {
    name: "#93a no cyan pip on a full module",
    file: F("renderer.js"),
    from: "        const cyb      = !damaged && hisUnit && p === fromReactor;",
    to:   "        const cyb      = false;",
  },
  {
    name: "#93a the cyborg paints over the broken reactor level",
    file: F("renderer.js"),
    from: "    const dmgN  = r.sys ? Math.min(capBase, r.sys.damagedLevels) : 0;",
    to:   "    const dmgN  = r.sys ? Math.max(0, Math.min(capBase, r.sys.damagedLevels) - (r.cyborgBonus ?? 0)) : 0;",
  },
  {
    name: "#93a the nebula is drawn as damage",
    file: F("renderer.js"),
    from: "        fill: damaged ? '#cc2233' : nebula ? '#8a3fbf'",
    to:   "        fill: damaged ? '#cc2233' : nebula ? '#cc2233'",
  },
  {
    name: "#93a the plague ignores the ducts",
    file: F("ship.js"),
    from: "                   : vents ? (h != null ? R[Math.min(h, R.length) - 1] : Ship.PLAGUE_RATE_VENT)",
    to:   "                   : vents ? Ship.PLAGUE_RATE_VENT",
  },
  {
    name: "#93a the duct next door is slow",
    file: F("ship.js"),
    from: "  static get PLAGUE_VENT_RATES() { return [0.03, 0.02, 0.012]; }",
    to:   "  static get PLAGUE_VENT_RATES() { return [0.02, 0.02, 0.012]; }",
  },
  {
    name: "#93a ten doses a box again",
    file: F("cargo.js"),
    from: "    stackMax: 5, unitValue: 6, healPerDose: 25,",
    to:   "    stackMax: 10, unitValue: 6, healPerDose: 25,",
  },
  {
    name: "#93a their names ignore ours",
    file: F("crew.js"),
    from: "      name: pickUniqueName(CREW_NAMES, [...result.map(r => r.name), ...CrewMember.namesInPlay()]),",
    to:   "      name: pickUniqueName(CREW_NAMES, result.map(r => r.name)),",
  },
  {
    name: "#93a nobody tells the names in play",
    file: F("game.js"),
    from: "    CrewMember.namesInPlay = () => {",
    to:   "    CrewMember._namesOff = () => {",
  },
  {
    name: "#93a a fresh man draws with replacement",
    file: F("crew.js"),
    from: "    this.name     = cfg.name  || pickUniqueName(CREW_NAMES, CrewMember.namesInPlay());",
    to:   "    this.name     = cfg.name  || Utils.pick(CREW_NAMES);",
  },
  {
    name: "#93a a port draws recruits with replacement",
    file: F("station.js"),
    from: "      const name  = pickUniqueName(CREW_NAMES, [...CrewMember.namesInPlay(), ...stock.crew.map(x => x.name)]);",
    to:   "      const name  = Utils.pick(CREW_NAMES);",
  },
  {
    name: "#93a their lifts wait for spare power",
    file: F("ship.js"),
    // Re-aimed in update98 (reflowPower, one indent less).
    from: "    const liftFirst = this.isPlayer ? 0 : Math.min(total, this.liftPowerNeed());",
    to:   "    const liftFirst = 0;",
  },
  {
    name: "#93a their reactor is not repaired first",
    file: F("combat.js"),
    from: "    const rank = (s) => s.type === 'reactor' ? 0 : (enemy.zeroG && s.type === 'engines') ? 1 : 2;",
    to:   "    const rank = (s) => (enemy.zeroG && s.type === 'engines') ? 1 : 2;",
  },
  {
    name: "#93a the boss flies without a commander",
    file: F("boss.js"),
    from: "    this._seatCommander();\n",
    to:   "",
  },
  {
    name: "#93a a new commander every phase",
    file: F("boss.js"),
    from: "    if (!this.captain) this.captain = Commander.rollEnemy(",
    to:   "    this.captain = Commander.rollEnemy(",
  },
  {
    name: "#93a a fresh boss keeps the old commander",
    file: F("boss.js"),
    from: "    this.captain = null;     // a fresh boss gets a fresh commander (update93a)\n",
    to:   "",
  },
  {
    name: "#93a the boss has no medicine chest",
    file: F("boss.js"),
    from: "    if (this._ship.cargo) for (let i = 0; i < 4; i++) this._ship.cargo.add('medkit');",
    to:   "",
  },
  {
    name: "#93a the cloak fires with nothing coming",
    file: F("combat.js"),
    from: "        if (incoming) {",
    to:   "        if (true) {",
  },
  {
    name: "#93b no wreckage after a kill",
    file: F("game.js"),
    from: "        if (_enemyShip && (_enemyShip.destroyed || _enemyShip.hull <= 0)) _spawnSalvage();",
    to:   "",
  },
  {
    name: "#93b crates after a crew wipe too",
    file: F("game.js"),
    from: "        if (_enemyShip && (_enemyShip.destroyed || _enemyShip.hull <= 0)) _spawnSalvage();",
    to:   "        if (_enemyShip) _spawnSalvage();",
  },
  {
    name: "#93b a big ship leaves no more than a small one",
    file: F("game.js"),
    from: "    const n = Utils.clamp(Utils.randIn(1, 1 + big), 1, SALVAGE.MAX_CRATES);",
    to:   "    const n = Utils.clamp(Utils.randIn(1, 2), 1, SALVAGE.MAX_CRATES);",
  },
  {
    name: "#93b no crate is ever empty",
    file: F("game.js"),
    from: "      const empty = Math.random() < SALVAGE.EMPTY_CHANCE;",
    to:   "      const empty = false;",
  },
  {
    name: "#93b her own cargo does not drift out",
    file: F("game.js"),
    from: "      Utils.pick(full).grid.add(it.defKey, it.meta ?? null, it.qty ?? null);",
    to:   "",
  },
  {
    name: "#93b the void bites through a full suit",
    file: F("game.js"),
    // Re-aimed in update107 (moved into _salvageBreathe).
    from: "    if (c.air <= 0) c.takeDamage(SALVAGE.VOID_DPS * dt, 'the void');",
    to:   "    c.takeDamage(SALVAGE.VOID_DPS * dt, 'the void');",
  },
  {
    name: "#93b a dry suit costs nothing",
    file: F("game.js"),
    // Re-aimed in update107.
    from: "    if (c.air <= 0) c.takeDamage(SALVAGE.VOID_DPS * dt, 'the void');",
    to:   "",
  },
  {
    name: "#93b an empty crate says nothing",
    file: F("game.js"),
    from: "      UI.notify(`${m.c.name}: empty — nothing in it but scorched plating.`, 'warn');",
    to:   "",
  },
  {
    name: "#93b one crate per trip",
    file: F("game.js"),
    from: "      if (!m.queue.includes(crate.id)) m.queue.push(crate.id);",
    to:   "",
  },
  {
    name: "#93b he never comes back aboard",
    file: F("game.js"),
    from: "          _playerShip.addCrew(c, true);\n          m.phase = 'aboard';",
    to:   "          m.phase = 'aboard';",
  },
  {
    name: "#93b the roster forgets the men outside",
    file: F("renderer.js"),
    from: "    const eva = (_evaCrew() ?? []).filter(c => c && !mine.includes(c) && !away.includes(c));",
    to:   "    const eva = [];",
  },
  {
    name: "#93b nobody tells the roster who is outside",
    file: F("game.js"),
    from: "    Renderer.setEvaCrew(() =>",
    to:   "    Renderer._noEva = (() =>",
  },
  {
    name: "#93b the men outside are not counted",
    file: F("game.js"),
    from: "    if (CombatManager.salvage) n += CombatManager.salvage.men.filter(m => m.phase !== 'muster' && !m.c.dead && !m.c.dying).length;",
    to:   "",
  },
  {
    name: "#93b JUMP leaves without a warning",
    file: F("game.js"),
    from: "          Input.isPressed('NumpadEnter') || jumpHit) && _leaveOutsideConfirmed()) {",
    to:   "          Input.isPressed('NumpadEnter') || jumpHit)) {",
  },
  {
    name: "#93b the jump takes the men outside along",
    file: F("game.js"),
    from: "        _abandonOutside('left behind in the wreckage');\n",
    to:   "",
  },
  {
    name: "#93b boarders are pulled off a blowing hull",
    file: F("game.js"),
    // Re-aimed in update105 (the sweep now keeps their boarders).
    from: "      _recoverBoarders({ aboardLost: 'went down with the enemy ship', keepIntruders: true });\n    }",
    to:   "      _recoverBoarders({ keepIntruders: true });\n    }",
  },
  {
    name: "#93b our jump brings the boarders home",
    file: F("game.js"),
    from: "      _recoverBoarders({ aboardLost: 'left behind when we jumped', flightLost: 'left behind when we jumped' });",
    to:   "      _recoverBoarders();",
  },
  {
    name: "#93b their jump hands our boarders back",
    file: F("game.js"),
    from: "      _recoverBoarders({ aboardLost: 'carried off on the enemy ship' });",
    to:   "      _recoverBoarders();",
  },
  {
    name: "#93b no warning when spooling with men outside",
    file: F("game.js"),
    from: "  function _warnOutsideOnRetreat() {\n    const out = _outsideCrew();",
    to:   "  function _warnOutsideOnRetreat() {\n    return;\n    const out = _outsideCrew();",
  },
  {
    name: "#93b a click on a crate does nothing",
    file: F("game.js"),
    from: "      if (crate) { _pressConsumed = true; _orderSalvage(crate); }",
    to:   "      if (false) { _pressConsumed = true; _orderSalvage(crate); }",
  },
  {
    name: "#93b the last fight's wreckage outlives it",
    file: F("combat.js"),
    from: "    this.salvage            = null;\n",
    to:   "",
  },
  {
    name: "#93b the wreckage is rolled once per game, not per fight",
    file: F("combat.js"),
    from: "    this._salvageRolled     = false;   // the wreckage is rolled once per fight\n",
    to:   "",
  },
  {
    name: "#93b their hull going is handled once per game",
    file: F("combat.js"),
    from: "    this._downHandled       = false;   // and their hull going is handled once\n",
    to:   "",
  },
  {
    name: "#93b the crate does not say who is going",
    file: F("game.js"),
    from: "k.by ? k.by.name.toUpperCase() :",
    to:   "k.by ? 'SEALED' :",
  },
  {
    name: "#93c the reactor badge asks for power it is never given",
    file: F("systems.js"),
    from: "    const powered = this.type === 'reactor'\n      ? (this.workingLevels > 0 && !this._offline)\n      : !this.isDisabled();",
    to:   "    const powered = !this.isDisabled();",
  },
  {
    name: "#93c the badge does not know a scram",
    file: F("ship.js"),
    from: "      if (sys.type === 'reactor') sys._offline = !!this.reactor?.offline;   // the badge (update93c)\n",
    to:   "",
  },
  {
    name: "#93c an enemy bag is priced like a pirate",
    file: F("cargo.js"),
    from: "    if (this.meta && this.meta.enemyBody) return portType === 'science' ? ENEMY_BODY_PRICE : 0;\n",
    to:   "",
  },
  {
    name: "#93c an enemy bag sells anywhere",
    file: F("cargo.js"),
    from: "    if (this.meta && this.meta.enemyBody) return portType === 'science' ? ENEMY_BODY_PRICE : 0;",
    to:   "    if (this.meta && this.meta.enemyBody) return ENEMY_BODY_PRICE;",
  },
  {
    name: "#93c an enemy bag fetches 60",
    file: F("cargo.js"),
    from: "const ENEMY_BODY_PRICE = 20;",
    to:   "const ENEMY_BODY_PRICE = 60;",
  },
  {
    name: "#93c the port does not say where to take him",
    file: F("cargo.js"),
    from: "    if (this.meta && this.meta.enemyBody && portType !== 'science') return 'only a research post buys these';\n",
    to:   "",
  },
  {
    name: "#93c one bolt kills the whole module",
    file: F("systems.js"),
    from: "    if (this.ionDamage > 0) p = Math.max(0, p - this.ionDamage);",
    to:   "    if (this.ionDamage > 0) p = 0;",
  },
  {
    name: "#93c ion takes nothing off",
    file: F("systems.js"),
    from: "    if (this.ionDamage > 0) p = Math.max(0, p - this.ionDamage);\n",
    to:   "",
  },
  {
    name: "#93c one bolt locks every level",
    file: F("systems.js"),
    from: "    for (let i = 0; i < Math.max(1, levels); i++) {",
    to:   "    for (let i = 0; i < Math.max(1, this.level); i++) {",
  },
  {
    name: "#93c ion locks never run out",
    file: F("systems.js"),
    from: "      this._ionLocks = this._ionLocks.map(t => t - dt).filter(t => t > 0);",
    to:   "      this._ionLocks = this._ionLocks.filter(t => t > 0);",
  },
  {
    name: "#93c any ion lock disables the module",
    file: F("systems.js"),
    from: "    return this.workingLevels <= 0 || this.effectivePower() <= 0;",
    to:   "    return this.workingLevels <= 0 || this.ionDamage > 0 || this.effectivePower() <= 0;",
  },
  {
    name: "#93c any ion lock paints the icon broken",
    file: F("renderer.js"),
    from: "    if (sys.workingLevels <= 0 || (sys.ionDamage > 0 && sys.effectivePower() <= 0)) return 'broken';",
    to:   "    if (sys.workingLevels <= 0 || sys.ionDamage > 0) return 'broken';",
  },
  {
    name: "#93c the hold does not touch the core",
    file: F("ship.js"),
    // Re-aimed in update105 (the console's share joined the sum).
    from: "    return this._loadHeatRate() + this.cargoHeatRate() - this.consoleCoolRate();",
    to:   "    return this._loadHeatRate() - this.consoleCoolRate();",
  },
  {
    name: "#93c a cooler in the hold does nothing",
    file: F("ship.js"),
    from: "    return cores * C.corePerSec - cool * C.coolerPerSec;",
    to:   "    return cores * C.corePerSec;",
  },
  {
    name: "#93c the reactor card says nothing about the hold",
    file: F("ship.js"),
    from: "          if (cores || cools) {",
    to:   "          if (false) {",
  },
  {
    name: "#94 Terra's tank no bigger than anyone's",
    file: F("crew.js"),
    from: "    terra:      16,   // update94, the player's call: \"troszkę większy niż podstawa\"\n",
    to:   "",
  },
  {
    name: "#94 a torpedo tube fires for free",
    file: F("combat.js"),
    from: "    if (ammo && ammo.kind === 'torpedoes') {",
    to:   "    if (false) {",
  },
  {
    name: "#94 the tube feeds from missiles",
    file: F("weapons.js"),
    from: "  if ((def.torpedoUse ?? 0) > 0) return { kind: 'torpedoes', use: def.torpedoUse, word: 'torpedo' };",
    to:   "  if ((def.torpedoUse ?? 0) > 0) return { kind: 'missiles', use: def.torpedoUse, word: 'missile' };",
  },
  {
    name: "#94 torpedoes in the shops of sector 1",
    file: F("station.js"),
    from: "      torpedoes: s >= 2 ? ri(0, 2 + s) : 0,",
    to:   "      torpedoes: ri(0, 2 + s),",
  },
  {
    name: "#94 the black market sells a tube in sector 1",
    file: F("station.js"),
    from: "d.cost <= 70 + s * 20 && (d.minSector ?? 1) <= s);",
    to:   "d.cost <= 70 + s * 20);",
  },
  {
    name: "#94 bought torpedoes go nowhere",
    file: F("station.js"),
    from: "    hold.addStack('torpedo_rack', avail);\n",
    to:   "",
  },
  {
    name: "#94 the plate stops nothing",
    file: F("ship.js"),
    from: "    const armor = this.armor ?? 0;\n    const rawMod",
    to:   "    const armor = 0;\n    const rawMod",
  },
  {
    name: "#94 nothing wears armour",
    file: F("ship.js"),
    from: "    this.armor     = this.layout?.armor ?? 0;",
    to:   "    this.armor     = 0;",
  },
  {
    name: "#94 the crew take the full hit through the plate",
    file: F("ship.js"),
    from: "      crewShare = through ? 0.5 : 0;",
    to:   "      crewShare = through ? 1 : 0;",
  },
  {
    name: "#94 a ringing laser still hurts the crew",
    file: F("ship.js"),
    from: "      crewShare = through ? 0.5 : 0;",
    to:   "      crewShare = 0.5;",
  },
  {
    name: "#94 no ARMOUR over the spot",
    file: F("ship.js"),
    from: "        Particles.floatText(proj.x, proj.y - 6, 'ARMOUR', '#c8d8f0', 11);\n",
    to:   "",
  },
  {
    name: "#94 a bunker dodges like a ship",
    file: F("ship.js"),
    from: "    if (this.layout?.immobile) return 0;\n",
    to:   "",
  },
  {
    name: "#94 a mech dodges like a ship",
    file: F("ship.js"),
    from: "    const slow = this.layout?.slow ? 0.5 : 1;",
    to:   "    const slow = 1;",
  },
  {
    name: "#94 a bunker rolls to jump away",
    file: F("combat.js"),
    from: "    if (!this._escapeRolled && !this.enemyShip.isDerelict && !grounded &&",
    to:   "    if (!this._escapeRolled && !this.enemyShip.isDerelict &&",
  },
  {
    name: "#94 a bunker leaves after a quiet minute",
    file: F("combat.js"),
    from: "    if (this._ai !== AI_DEFS.boss && !this.enemyShip.isDerelict && !grounded && !this.enemyEscapeActive) {",
    to:   "    if (this._ai !== AI_DEFS.boss && !this.enemyShip.isDerelict && !this.enemyEscapeActive) {",
  },
  {
    name: "#94 bunkers in sector 1",
    file: F("game.js"),
    from: "      if ((Save.getRun()?.sector ?? 1) < 2) return null;\n",
    to:   "",
  },
  {
    name: "#94 an elite comes as a bunker",
    file: F("game.js"),
    from: "      if (difficulty === 'hard' || _wantedHere) return null;",
    to:   "      if (_wantedHere) return null;",
  },
  {
    name: "#94 no extra hull on the ground",
    file: F("game.js"),
    from: "    if (_enemyShip.layout?.grounded) _enemyShip.hull += 4;\n",
    to:   "",
  },
  {
    name: "#94 bunkers as common as ships",
    file: F("game.js"),
    from: "  const GROUND_ODDS = { bunker: 0.12, mech: 0.10 };",
    to:   "  const GROUND_ODDS = { bunker: 0.45, mech: 0.40 };",
  },
  {
    name: "#94 the big bunker gets its shields back",
    file: F("ship.js"),
    from: "      { id:'r_shields',  type:'empty',    col:1, row:2, adjacent:['r_weapons3'] },",
    to:   "      { id:'r_shields',  type:'shields',  col:1, row:2, adjacent:['r_weapons3'] },",
  },
  {
    name: "#94 the big bunker takes off",
    file: F("ship.js"),
    from: "Engines at 3. */\n    isStation: true, grounded: true, immobile: true, armor: 1,",
    to:   "Engines at 3. */\n    isStation: true,",
  },
  {
    name: "#94 a mech without its tracks",
    file: F("ship.js"),
    from: "    if (this.layout?.tracks) this._drawTracks(ctx, b);\n",
    to:   "",
  },
  {
    name: "#94 no ARMOUR pill on the enemy panel",
    file: F("renderer.js"),
    from: "      if ((e.armor ?? 0) > 0) _statPill(ctx, eX + 156, 52, 'ARMOUR', `-${e.armor} / hit`, '#c8d8f0');\n",
    to:   "",
  },
  {
    name: "#94 the torpedoes are not on the bar",
    file: F("renderer.js"),
    from: "        ctx.fillText(`T${trp}`, resX + 204, 28);\n",
    to:   "",
  },
  {
    name: "#95 the lift stops on a deck with nothing on it",
    file: F("ship.js"),
    from: "    if (!grid.some(r => r.row === row)) continue;\n",
    to:   "",
  },
  {
    name: "#95 an airlock hung on the lift's door (left)",
    file: F("ship.js"),
    from: "      if (!wallOnShaft(leftmost.x)) {\n        this.doors.push(",
    to:   "      if (true) {\n        this.doors.push(",
  },
  {
    name: "#95 an airlock hung on the lift's door (right)",
    file: F("ship.js"),
    from: "      if (rightmost.id !== leftmost.id && !wallOnShaft(rightmost.x + rightmost.w)) {",
    to:   "      if (rightmost.id !== leftmost.id) {",
  },
  {
    name: "#95 the yard does not sell the new hulls",
    file: F("base.js"),
    from: "  thoth: {\n    key: 'thoth', cost: 280,",
    to:   "  _thoth: {\n    key: 'thoth', cost: 280,",
  },
  {
    name: "#95 Osiris cheaper than Isis",
    file: F("base.js"),
    from: "    key: 'osiris', cost: 420,",
    to:   "    key: 'osiris', cost: 360,",
  },
  {
    name: "#95 the new enemy hulls never turn up",
    file: F("game.js"),
    from: "  const ENEMY_POOL = ['enemy_frigate', 'enemy_gunship', 'enemy_raider',\n                      'enemy_ra', 'enemy_khnum', 'enemy_hathor', 'enemy_montu'];",
    to:   "  const ENEMY_POOL = ['enemy_frigate', 'enemy_gunship', 'enemy_raider'];",
  },
  {
    name: "#95 two-gun Nephthys in sector 1",
    file: F("game.js"),
    from: "Utils.pick(sectorNow >= 2 ? ENEMY_POOL.concat(['enemy_nephthys']) : ENEMY_POOL)",
    to:   "Utils.pick(ENEMY_POOL.concat(['enemy_nephthys']))",
  },
  {
    name: "#95 elites never fly Nephthys",
    file: F("game.js"),
    from: "      ? Utils.pick(['enemy_gunship', 'enemy_gunship', 'enemy_raider', 'enemy_nephthys'])",
    to:   "      ? Utils.pick(['enemy_gunship', 'enemy_gunship', 'enemy_raider'])",
  },
  {
    name: "#95 enemy torpedoes in sector 1",
    file: F("game.js"),
    from: "      if (slot === 1 && sector >= 2 && Math.random() < ENEMY_TORPEDO_ODDS) {",
    to:   "      if (slot === 1 && Math.random() < ENEMY_TORPEDO_ODDS) {",
  },
  {
    name: "#95 every second bay a torpedo tube",
    file: F("game.js"),
    from: "  const ENEMY_TORPEDO_ODDS = 0.25;",
    to:   "  const ENEMY_TORPEDO_ODDS = 1;",
  },
  {
    name: "#95 the enemy never gets a torpedo",
    file: F("game.js"),
    from: "  const ENEMY_TORPEDO_ODDS = 0.25;",
    to:   "  const ENEMY_TORPEDO_ODDS = 0;",
  },
  {
    name: "#95 the new hulls never drift as wrecks",
    file: F("wreck.js"),
    from: "const DERELICT_LAYOUTS = ['enemy_frigate', 'enemy_gunship', 'enemy_raider',\n                          'enemy_ra', 'enemy_khnum', 'enemy_hathor', 'enemy_montu'];",
    to:   "const DERELICT_LAYOUTS = ['enemy_frigate', 'enemy_gunship', 'enemy_raider'];",
  },
  {
    name: "#95 Hathor's lower deck drawn one column over",
    file: F("ship.js"),
    from: "      { id:'r_reactor',  type:'reactor',  col:1, row:0, adjacent:['r_oxygen'] },\n    ],\n    startSystems: ['engines','weapons','shields','piloting','oxygen','reactor'],\n    systemLevels: { oxygen: 2, shields: 2, weapons: 2, engines: 2 },\n    startWeapons: ['laser_basic'],\n    reactorLevel: 8,\n    reactorMax: 12,\n    weaponSlots: 1,\n  }),\n\n  /** Enemy. Two decks slid",
    to:   "      { id:'r_reactor',  type:'reactor',  col:2, row:0, adjacent:['r_oxygen'] },\n    ],\n    startSystems: ['engines','weapons','shields','piloting','oxygen','reactor'],\n    systemLevels: { oxygen: 2, shields: 2, weapons: 2, engines: 2 },\n    startWeapons: ['laser_basic'],\n    reactorLevel: 8,\n    reactorMax: 12,\n    weaponSlots: 1,\n  }),\n\n  /** Enemy. Two decks slid",
  },
  {
    name: "#95 a spare bay on Ra (it would fill with prisoners)",
    file: F("ship.js"),
    from: "      { id:'r_medbay',   type:'medbay',   col:1, row:1, adjacent:[] },",
    to:   "      { id:'r_medbay',   type:'empty',    col:1, row:1, adjacent:[] },",
  },
  {
    name: "#95 Thoth's extra is a shield, like Isis's",
    file: F("ship.js"),
    from: "      { id:'r_medbay',   type:'medbay',   col:3, row:0, adjacent:['r_oxygen'] },",
    to:   "      { id:'r_medbay',   type:'shields',  col:3, row:0, adjacent:['r_oxygen'] },",
  },
  {
    name: "#95 Thoth comes fully fitted (a second extra)",
    file: F("ship.js"),
    from: "      { id:'r_hold2',    type:'empty',    col:3, row:2, adjacent:['r_hold1'] },\n      { id:'r_engines',  type:'engines',  col:0, row:1, adjacent:['r_piloting'] },\n      { id:'r_piloting', type:'piloting', col:1, row:1, adjacent:['r_engines'] },\n      { id:'r_reactor',  type:'reactor',  col:1, row:0, adjacent:['r_oxygen'] },",
    to:   "      { id:'r_hold2',    type:'cloaking', col:3, row:2, adjacent:['r_hold1'] },\n      { id:'r_engines',  type:'engines',  col:0, row:1, adjacent:['r_piloting'] },\n      { id:'r_piloting', type:'piloting', col:1, row:1, adjacent:['r_engines'] },\n      { id:'r_reactor',  type:'reactor',  col:1, row:0, adjacent:['r_oxygen'] },",
  },
  {
    name: "#95 Osiris sails with one gun",
    file: F("ship.js"),
    from: "    startWeapons: ['laser_heavy', 'laser_burst'],",
    to:   "    startWeapons: ['laser_heavy'],",
  },
  {
    name: "#95 Isis armed with an ion cannon (it cannot hurt a hull)",
    file: F("ship.js"),
    from: "    startWeapons: ['laser_heavy'],\n    reactorLevel: 9,",
    to:   "    startWeapons: ['ion_basic'],\n    reactorLevel: 9,",
  },
  {
    name: "#95 Isis's reactor a pip short",
    file: F("ship.js"),
    from: "    reactorLevel: 9,      // engines 2, gun 2, shields 2, cockpit 1, air 2",
    to:   "    reactorLevel: 8,      // engines 2, gun 2, shields 2, cockpit 1, air 2",
  },
  {
    name: "#95 the warship gets the trader's hold",
    file: F("ship.js"),
    from: "    weaponSlots: 2,\n    cargoCols: 6, cargoRows: 4,",
    to:   "    weaponSlots: 2,\n    cargoCols: 7, cargoRows: 5,",
  },
  {
    name: "#96 two ranks share a picture again (update125: dots and bars)",
    file: F('renderer.js'),
    from: "    return { marks: (n % 4) + 1, bars: Math.floor(n / 4), star };",
    to:   "    return { marks: (n % 4) + 1, bars: Math.min(1, Math.floor(n / 4)), star };",
  },
  {
    name: "#96 the top ranks lose their stars (update125)",
    file: F('renderer.js'),
    from: "    const star = l >= 17, n = star ? l - 17 : l - 1;",
    to:   "    const star = false, n = l >= 17 ? l - 17 : l - 1;",
  },
  {
    name: "#96 the stars in the silver of the dots (update125)",
    file: F('renderer.js'),
    from: "    { from: 17, to: 24, key: 'gold',   col: '#ffd24a' },",
    to:   "    { from: 17, to: 24, key: 'gold',   col: '#c8d0dc' },",
  },
  {
    name: "#96 engines drawn with the pilot's yoke",
    file: F("renderer.js"),
    from: "    piloting: 'sk_pilot', weapons: 'sk_gun', engines: 'sk_engine',",
    to:   "    piloting: 'sk_pilot', weapons: 'sk_gun', engines: 'sk_pilot',",
  },
  {
    name: "#96 a list of specialisations is read as a man",
    file: F("renderer.js"),
    from: "    const keys = Array.isArray(rec) ? rec : specialtiesOf(rec);",
    to:   "    const keys = specialtiesOf(rec);",
  },
  {
    name: "#96 the fight roster loses its insignia",
    file: F("renderer.js"),
    from: "        drawRankInsignia(ctx, c.rankLevel ? c.rankLevel() : 0, ix, iy, IH);\n        _rankZones.push(",
    to:   "        _rankZones.push(",
  },
  {
    name: "#96 the rank tip filed with the condition marks",
    file: F("renderer.js"),
    from: "        _rankZones.push({ x: ix - 1, y: iy - 1, w: iw + 2, h: IH + 2, tip: rankTip(c), crew: c });",
    to:   "        _crewMarkZones.push({ x: ix - 1, y: iy - 1, w: iw + 2, h: IH + 2, tip: rankTip(c), crew: c });",
  },
  {
    /* Re-aimed in update97: the tooltip over the insignia is GONE on
       purpose (it covered the crew panel). The revert brings it back. */
    name: "#97 the insignia opens its tooltip over the crew panel again",
    file: F("renderer.js"),
    from: "    const hov = _crewMarkZones.find(z => z.tip &&",
    to:   "    const hov = _crewMarkZones.concat(_rankZones).find(z => z.tip &&",
  },
  {
    name: "#96 the tip forgets the specialisations",
    file: F("renderer.js"),
    from: "    return `${name} (${lvl})` + (spec.length ? ` · specialist: ${spec.join(', ')}` : ' · no specialisation');",
    to:   "    return `${name} (${lvl})`;",
  },
  {
    name: "#96 the barracks card loses the insignia",
    // Re-aimed in update112 (the card is Renderer.drawCrewCard).
    file: F("renderer.js"),
    from: "      mx += _ins(ctx, F.lvl, mx, iy, insH) + 4;",
    to:   "      mx += 4;",
  },
  {
    name: "#96 the barracks card loses the specialisations",
    // Re-aimed in update112 (the card is Renderer.drawCrewCard).
    file: F("renderer.js"),
    from: "      if (mx < right - insH) _spec(ctx, cmd ? F.spec : rec, mx, iy, insH, 2);",
    to:   "",
  },
  {
    name: "#96 the mess card loses the insignia",
    // Re-aimed in update112: the candidate is the crew card, its insignia drawn there.
    file: F("renderer.js"),
    from: "      mx += _ins(ctx, F.lvl, mx, iy, insH) + 4;",
    to:   "      mx += (() => 0)(ctx, F.lvl, mx, iy, insH) + 4;",
  },
  {
    name: "#96 the dossier without the insignia",
    file: F("renderer.js"),
    from: "    drawRankInsignia(ctx, lvl, px + PW - 18 - ctx.measureText(rank).width - 30, py + 21, 12);\n",
    to:   "",
  },
  {
    name: "#96 the dossier lists specialisations without icons",
    file: F("renderer.js"),
    from: "        drawSpecialties(ctx, [k], LX, ly - 9, 10);\n",
    to:   "",
  },
  {
    name: "#96 the ui.js panel keeps its star",
    file: F("ui.js"),
    from: "      Renderer.drawRankInsignia(ctx, c.rankLevel ? c.rankLevel() : 0, PX + PW - 64, cy + 4, 10);\n",
    to:   "      ctx.fillText('★', PX + PW - 8, cy + 14);\n",
  },
  {
    name: "#96 the star comes back to the crewman",
    file: F("crew.js"),
    from: "  rankLevel() { return rankLevelOf(this); }",
    to:   "  rankLevel() { return rankLevelOf(this); }\n  getStarRating() { return this.rankLevel() >= 14 ? 'gold' : 'none'; }",
  },
  {
    name: "#97 their reactor shows no nebula",
    file: F("renderer.js"),
    from: "        const nebula  = reactorCol && p >= ownR && p < ownR + penR;",
    to:   "        const nebula  = false;",
  },
  {
    name: "#97 their reactor has no heat bar",
    file: F("renderer.js"),
    from: "      if (reactorCol) {\n        const H =",
    to:   "      if (false) {\n        const H =",
  },
  {
    name: "#97 the core back to a hundred degrees",
    file: F("ship.js"),
    from: "  maxCelsius: 1300,",
    to:   "  maxCelsius: 100,",
  },
  {
    name: "#97 repairs back to their old speed",
    file: F("systems.js"),
    from: "const SYSTEM_REPAIR_RATE = 0.10;",
    to:   "const SYSTEM_REPAIR_RATE = 0.12;",
  },
  {
    name: "#97 the low-hull glow over the whole box again",
    file: F("ship.js"),
    from: "      this._hullPlatePath(ctx, -4);\n      ctx.fillStyle = `rgba(255,45,68,${alpha})`;\n      ctx.fill();",
    to:   "      const b = this.roomBounds();\n      ctx.fillStyle = `rgba(255,45,68,${alpha})`;\n      ctx.fillRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28);",
  },
  {
    name: "#97 a fire short of air never goes blue",
    file: F("fire.js"),
    from: "      fire.starved = !!ro && ro.level < FIRE_DEFS.STARVED_O2;",
    to:   "      fire.starved = false;",
  },
  {
    name: "#97 the flames never take the starved colours",
    file: F("fire.js"),
    from: "          this.y + Utils.randFloat(-8, 8),\n          !!this.starved\n        );",
    to:   "          this.y + Utils.randFloat(-8, 8),\n          false\n        );",
  },
  {
    name: "#97 our bubble fills itself on the jump in",
    file: F("game.js"),
    from: "    _playerShip.resetShieldDebt();\n    /* Only a ship you jump in on",
    to:   "    _playerShip.prechargeShields();\n    /* Only a ship you jump in on",
  },
  {
    name: "#97 the bubble charges with the covers off",
    file: F("systems.js"),
    from: "    if (this._shieldBars < layers && this._repairHold > 0) return;   // under repair (update97)\n",
    to:   "",
  },
  {
    name: "#97 never caught napping",
    file: F("game.js"),
    from: "  const ENEMY_SURPRISE_ODDS = 0.20;",
    to:   "  const ENEMY_SURPRISE_ODDS = 0;",
  },
  {
    name: "#97 a ship that hailed us can be caught napping",
    file: F("game.js"),
    from: "    const surprised = !!opts.canSurprise && !opts.ambush &&",
    to:   "    const surprised = !opts.ambush &&",
  },
  {
    name: "#97 their crew walk to their posts",
    file: F("game.js"),
    from: "      _enemyShip.prechargeShields();\n      _enemyShip.snapToStations();",
    to:   "      _enemyShip.prechargeShields();",
  },
  {
    name: "#97 the posts that fight go off repairing",
    file: F("combat.js"),
    from: "      let pool = idle.filter(c => !postOf(c));",
    to:   "      let pool = idle;",
  },
  {
    name: "#97 no spare hand in their crew",
    file: F("game.js"),
    from: "    const crewN    = Math.max(floor, 1 + guns + shieldHand + 1 + (elite ? 1 : 0));",
    to:   "    const crewN    = Math.max(floor, 1 + guns + (elite ? 1 : 0));",
  },
  {
    name: "#97 their wounded never go to the ward",
    file: F("combat.js"),
    from: "const ENEMY_HEAL_AT = 0.40;",
    to:   "const ENEMY_HEAL_AT = 0;",
  },
  {
    name: "#97 the ward before the fire",
    file: F("combat.js"),
    from: "        if (!bayOk || !calm || frac >= ENEMY_HEAL_AT",
    to:   "        if (!bayOk || frac >= ENEMY_HEAL_AT",
  },
  {
    name: "#97 the gun bolts itself on again",
    file: F("game.js"),
    from: "    if (CombatManager.weaponDrop && _playerShip && !_salvageWillSpawn()) {",
    to:   "    if (CombatManager.weaponDrop && _playerShip) {",
  },
  {
    name: "#97 her whole medicine chest drifts out",
    file: F("game.js"),
    from: "    items.filter(it => it.def?.kind !== 'heal').forEach(it => {",
    to:   "    items.forEach(it => {",
  },
  {
    name: "#97 medkits as common as before",
    file: F("cargo.js"),
    from: "    ['medkit',         6],   // update97: was 13 — too often (jj)",
    to:   "    ['medkit',        13],",
  },
  {
    name: "#97 no HEAL in his menu",
    file: F("game.js"),
    from: "    return _playerShip?.getSystem('carbonite') ? ['feed', 'heal', 'freeze'] : ['feed', 'heal'];",
    to:   "    return _playerShip?.getSystem('carbonite') ? ['feed', 'freeze'] : ['feed'];",
  },
  {
    name: "#97 a dose never touches the plague",
    file: F("ship.js"),
    from: "    if (who.infected && !who.virus) {\n      who.infected = false; who._infT = 0;",
    to:   "    if (false) {\n      who.infected = false; who._infT = 0;",
  },
  {
    name: "#97 the dose is opened and nothing happens",
    file: F("ship.js"),
    from: "      if (act === 'heal')   this._finishHeal(on ?? c);\n",
    to:   "",
  },
  {
    name: "#97 no rank in the crew panel",
    file: F("ui.js"),
    from: "    const RANK_H = crew.isPet ? 0 : 32;",
    to:   "    const RANK_H = 0;",
  },
  {
    name: "#97 the wheel does not move the roster",
    file: F("renderer.js"),
    from: "    _rosterScroll = Utils.clamp(_rosterScroll + Math.sign(step), 0, _rosterBox.max);",
    to:   "    _rosterScroll = Utils.clamp(_rosterScroll, 0, _rosterBox.max);",
  },
  {
    name: "#97 a selected man stays off the list",
    file: F("renderer.js"),
    from: "      if (selIdx >= _rosterScroll + win) _rosterScroll = selIdx - win + 1;\n",
    to:   "",
  },
  {
    name: "#97 the game never passes the wheel to the roster",
    file: F("game.js"),
    from: "        Renderer.scrollRoster(wheel);\n",
    to:   "",
  },
  /* ── update98: the commander, package A (four attributes, knowledge,
     orders paid for, leadership/endurance for his own, the commander
     bar) + the nebula settled at once. ── */
  {
    name: "#98 the knowledge pool does not grow with KNOWLEDGE",
    file: F("commander.js"),
    from: "    return KNOWLEDGE_BASE + KNOWLEDGE_PER_POINT * attr(cap, 'knowledge');",
    to:   "    return KNOWLEDGE_BASE;",
  },
  {
    name: "#98 a KNOWLEDGE point leaves the new room empty",
    file: F("commander.js"),
    from: "    if (k === 'knowledge') cap.knowledge = Math.min(knowledgeMax(cap), cap.knowledge + KNOWLEDGE_PER_POINT);\n",
    to:   "",
  },
  {
    name: "#98 an old commander keeps his picks",
    file: F("commander.js"),
    from: "    if ('picks' in cap) delete cap.picks;\n",
    to:   "",
  },
  {
    name: "#98 points owed ignore what was spent",
    file: F("commander.js"),
    from: "    return Math.max(0, Utils.clamp(cap.level, 0, COMMANDER_MAX_LEVEL) - pointsSpent(cap));",
    to:   "    return Math.max(0, Utils.clamp(cap.level, 0, COMMANDER_MAX_LEVEL) - 0);",
  },
  {
    name: "#98 any word is an attribute",
    file: F("commander.js"),
    from: "    if (!COMMANDER_ATTRS.includes(k)) return false;\n    migrate(cap);\n    cap.attrs[k] += 1;",
    to:   "    migrate(cap);\n    cap.attrs[k] = (cap.attrs[k] || 0) + 1;",
  },
  {
    name: "#98 knowledge can be spent below zero",
    file: F("commander.js"),
    from: "    if (have < n) return false;\n",
    to:   "",
  },
  {
    name: "#98 a refill runs past full",
    file: F("commander.js"),
    from: "    const to = Math.min(max, have + Math.ceil(max * Utils.clamp(frac, 0, 1)));",
    to:   "    const to = have + Math.ceil(max * Utils.clamp(frac, 0, 1));",
  },
  {
    name: "#98 INT 6 does not read level III",
    file: F("commander.js"),
    from: "    if (i >= 6) return 3;",
    to:   "    if (i >= 7) return 3;",
  },
  {
    name: "#98 leadership has no steps at 3/5/7/9",
    file: F("commander.js"),
    from: "    LEADERSHIP_STEPS.forEach(st => { if (n >= st.at) out[st.effect] += st.value; });\n",
    to:   "",
  },
  {
    name: "#98 leadership and endurance reach every corporation",
    file: F("commander.js"),
    from: "    if (crew.race !== boss.race) return out;\n    const lead = leadershipBonus(boss);",
    to:   "    const lead = leadershipBonus(boss);",
  },
  {
    name: "#98 endurance HP never reaches the bar",
    file: F("commander.js"),
    from: "      const want = Math.max(1, Math.round(base * (1 + b.hp)) + (b.hpFlat || 0));",
    to:   "      const want = Math.max(1, Math.round(base * (1 + b.hp)));",
  },
  {
    name: "#98 endurance does not lengthen the bottle",
    file: F("crew.js"),
    from: "    return (t[this.race] ?? t._default) * (1 + air);",
    to:   "    return (t[this.race] ?? t._default);",
  },
  {
    name: "#98 an order he cannot pay for is given",
    file: F("commander.js"),
    from: "    if (knowledge(cap) < cost) {",
    to:   "    if (false) {",
  },
  {
    name: "#98 a given order costs nothing",
    file: F("commander.js"),
    from: "    if (!spendKnowledge(cap, orderCost(key))) return false;\n",
    to:   "",
  },
  {
    name: "#98 the enemy commander spends on knowledge and intelligence",
    file: F("commander.js"),
    from: "      const trades = ['leadership', 'endurance'];",
    to:   "      const trades = ['knowledge', 'intelligence'];",
  },
  {
    name: "#98 a CLOSE ALL that moves nothing is paid for",
    file: F("game.js"),
    from: "    if (!moved) {\n      UI.notify(open ? 'Every door is already open.' : 'Every door is already closed.', 'info');\n      return;\n    }\n",
    to:   "",
  },
  {
    name: "#98 BOARD is free",
    file: F("game.js"),
    from: "    _payOrder('board');\n    _boardingParty = party;",
    to:   "    _boardingParty = party;",
  },
  {
    name: "#98 RECALL needs no commander",
    file: F("game.js"),
    from: "    if (_orderRefused('recall')) return;\n",
    to:   "",
  },
  {
    name: "#98 SAVE POS is free",
    file: F("game.js"),
    from: "    if (_orderRefused('save')) return;\n    _payOrder('save');",
    to:   "    if (_orderRefused('save')) return;",
  },
  {
    name: "#98 nothing comes back after a fight",
    file: F("combat.js"),
    from: "    if (this._knowledgeDue) {",
    to:   "    if (false) {",
  },
  {
    name: "#98 every end() pays the fight again",
    file: F("combat.js"),
    from: "      this._knowledgeDue = false;\n",
    to:   "",
  },
  {
    name: "#98 a port does not rest him",
    file: F("game.js"),
    from: "        const got = Commander.refillKnowledge(_commander, 1);\n        if (got > 0) UI.notify(`${_commander.name} rests in port",
    to:   "        const got = 0;\n        if (got > 0) UI.notify(`${_commander.name} rests in port",
  },
  {
    name: "#98 he leaves base with what he had",
    file: F("game.js"),
    from: "        Commander.refillKnowledge?.(_commander, 1);\n        Base.saveCommander?.(_commander);",
    to:   "        Base.saveCommander?.(_commander);",
  },
  {
    name: "#98 home at base does not fill him",
    file: F("game.js"),
    from: "      Commander?.refillKnowledge?.(_commander, 1);     // home: full (update98)\n",
    to:   "",
  },
  {
    name: "#98 the commander bar is never drawn",
    file: F("renderer.js"),
    from: "    if (barUp) _drawCommanderBar(ctx, state);",
    to:   "    void 0;",
  },
  /* (#98 "the commander bar hangs over the map too" retired in update104:
     jj wants it there — the reverse is guarded by #104.) */
  {
    name: "#98 the specials on the bar are not clickable",
    file: F("renderer.js"),
    from: "      _powerClickZones.push({ ...sp, specialOrder: sp.key });\n",
    to:   "",
  },
  {
    name: "#98 the bar does not say what an order costs",
    file: F("renderer.js"),
    from: "      ctx.fillText(String(cost), sp.x + sp.w - 2, sp.y + sp.h - 2);\n",
    to:   "",
  },
  {
    name: "#98 the tip calls an order he cannot afford READY",
    file: F("renderer.js"),
    from: "short ? 'NOT ENOUGH KNOWLEDGE' : 'READY'",
    to:   "'READY'",
  },
  {
    name: "#98 SAVE POS looks live with an empty pool",
    file: F("renderer.js"),
    from: "    btn(R.crewSave,   'SAVE POS',  '#4db8ff', has && pays('save'));",
    to:   "    btn(R.crewSave,   'SAVE POS',  '#4db8ff', has);",
  },
  {
    name: "#98 the order panel does not say what orders cost",
    file: F("renderer.js"),
    from: "    ctx.fillText(has ? 'ORDERS · 1 KN (BOARD 5)' : 'ORDERS — NO COMMANDER', ORDER_X, top + 8);",
    to:   "    ctx.fillText(has ? 'ORDERS' : 'ORDERS — NO COMMANDER', ORDER_X, top + 8);",
  },
  {
    name: "#98 the file offers no [+]",
    file: F("renderer.js"),
    from: "          out.attrPlus.push(z);\n",
    to:   "",
  },
  {
    name: "#98 the [+] in the file on the map does nothing",
    file: F("game.js"),
    from: "    if (plus) {\n      if (Commander.spendPoint(_commander, plus.attr)) {",
    to:   "    if (false) {\n      if (Commander.spendPoint(_commander, plus.attr)) {",
  },
  {
    name: "#98 the mess file has no [+] zones",
    file: F("basescreen.js"),
    from: "      (r.attrPlus || []).forEach(z => _zones.push({ ...z, act: 'attrPoint', arg: { id: _dossierId, attr: z.attr } }));\n",
    to:   "",
  },
  {
    name: "#98 an endurance point waits for the next launch",
    file: F("game.js"),
    from: "      if (o.key === 'endurance' && _playerShip) Commander.reseatMaxHp(_playerShip.crew);\n      if (Commander.pointsOwed(_promo.cap) <= 0) {",
    to:   "      if (Commander.pointsOwed(_promo.cap) <= 0) {",
  },
  {
    name: "#98 the mess never migrates its commanders",
    file: F("base.js"),
    from: "      (d.base.commanders ?? []).forEach(c => Commander.migrate(c));\n",
    to:   "",
  },
  {
    name: "#98 the promotion screen offers the old two trades",
    file: F("game.js"),
    from: "    const opts = (typeof Commander !== 'undefined' && _promo) ? Commander.ATTRS : [];",
    to:   "    const opts = (typeof Commander !== 'undefined' && _promo) ? Commander.ATTRS.slice(2) : [];",
  },
  {
    name: "#98 the nebula is settled one frame late (-1/6)",
    file: F("game.js"),
    from: "    _playerShip.reflowPower();\n",
    to:   "",
  },
  /* ── update99: the tablets, package B (chips gone, eleven tablets, the
     level of three, knowledge per use, Book, quick bar, bosses and crates). ── */
  {
    name: "#99 a Sumerian tablet needs more than its threshold",
    file: F("chips.js"),
    from: "    return f.side === 'good' ? f.karma.filter(t => k >= t).length",
    to:   "    return f.side === 'good' ? f.karma.filter(t => k > t).length",
  },
  {
    name: "#99 a neutral tablet minds karma",
    file: F("chips.js"),
    from: "    if (!f.karma) return 4;",
    to:   "    if (!f.karma) return (karma ?? 50) >= 55 ? 4 : 0;",
  },
  {
    name: "#99 INT does not cap a tablet",
    file: F("chips.js"),
    from: "    return Math.min(it.def.chipLevel ?? 1, intCap(cap), karmaCap(it.def.chipFamily, cap?.karma));",
    to:   "    return Math.min(it.def.chipLevel ?? 1, karmaCap(it.def.chipFamily, cap?.karma));",
  },
  {
    name: "#99 karma does not cap a tablet",
    file: F("chips.js"),
    from: "    return Math.min(it.def.chipLevel ?? 1, intCap(cap), karmaCap(it.def.chipFamily, cap?.karma));",
    to:   "    return Math.min(it.def.chipLevel ?? 1, intCap(cap));",
  },
  {
    name: "#99 two of a kind: the first answers, not the best",
    file: F("chips.js"),
    from: "      if (!was || eff > was.eff || (eff === was.eff && (it.def.chipLevel ?? 1) > was.level)) {",
    to:   "      if (!was) {",
  },
  {
    name: "#99 Re-Atum can be used by hand",
    file: F("chips.js"),
    from: "    if (def.where === 'passive') return `${def.label} works by itself — it is not used by hand.`;\n",
    to:   "",
  },
  {
    name: "#99 an unwired tablet does not say so",
    file: F("chips.js"),
    from: "    if (!def.live) return `${def.label} — its power arrives with package ${def.pkg} (not wired yet).`;\n",
    to:   "",
  },
  {
    name: "#99 a fight-only tablet works on the map",
    file: F("chips.js"),
    from: "    if (def.where === 'combat' && where !== 'combat') return `${def.label} — only in a fight.`;\n",
    to:   "",
  },
  {
    name: "#99 a running tablet can be stacked",
    file: F("chips.js"),
    from: "    if (running(key)) return `${def.label} — already working (${Math.ceil(runningLeft(key))} s).`;\n",
    to:   "",
  },
  {
    name: "#99 a tablet does not ask for the knowledge first",
    file: F("chips.js"),
    from: "    if (have < cost) return `${def.label} — not enough knowledge (${cost} needed, ${Math.floor(have)} left).`;\n",
    to:   "",
  },
  {
    name: "#99 a use costs no knowledge",
    file: F("chips.js"),
    from: "    if (typeof Commander !== 'undefined'\n        && !Commander.spendKnowledge(cap, costOf(key, t.eff))) return 0;\n",
    to:   "",
  },
  {
    name: "#99 a timed tablet starts no clock",
    file: F("chips.js"),
    from: "    if (Array.isArray(secs)) _run[key] = { t: secs[t.eff - 1], lvl: t.eff, ship: opts.ship || null };\n",
    to:   "",
  },
  {
    name: "#99 a running tablet pays nothing",
    file: F("chips.js"),
    from: "      if (Array.isArray(arr)) v = Math.max(v, arr[r.lvl - 1] ?? 0);",
    to:   "      void arr;",
  },
  {
    name: "#99 the Was drain outlives its clock",
    file: F("chips.js"),
    from: "    if (key === 'was' && r.ship?.reactor) r.ship.reactor.drain = 0;\n",
    to:   "",
  },
  {
    name: "#99 the quick bar leads with dark tablets",
    file: F("chips.js"),
    from: "    return mine.filter(t => t.eff > 0).concat(mine.filter(t => t.eff <= 0)).slice(0, QUICK_MAX);",
    to:   "    return mine.slice(0, QUICK_MAX);",
  },
  {
    name: "#99 Re-Atum goes on the quick bar",
    file: F("chips.js"),
    from: "    if (!cap || !TABLET_DEFS[key] || TABLET_DEFS[key].where === 'passive') return false;",
    to:   "    if (!cap || !TABLET_DEFS[key]) return false;",
  },
  {
    name: "#99 the quick bar holds five",
    file: F("chips.js"),
    from: "  const QUICK_MAX = 4;",
    to:   "  const QUICK_MAX = 5;",
  },
  {
    name: "#99 the pod reads the tablet, not the level it works at",
    file: F("chips.js"),
    from: "    return (t && t.eff > 0) ? TABLET_DEFS.re_atum.pod[t.eff - 1] : 0;",
    to:   "    return (t && t.eff > 0) ? TABLET_DEFS.re_atum.pod[t.level - 1] : 0;",
  },
  {
    name: "#99 sector 3 drops low tablets too",
    file: F("chips.js"),
    from: "const TABLET_SECTOR_LEVELS = { 1: [1, 1], 2: [1, 2], 3: [3, 3] };",
    to:   "const TABLET_SECTOR_LEVELS = { 1: [1, 1], 2: [1, 2], 3: [1, 3] };",
  },
  {
    name: "#99 a neutral IV is a 4-bar",
    file: F("chips.js"),
    from: "  if (family === 'neutral' && level === 4) return { w: 2, h: 2 };",
    to:   "  if (family === 'uni' && level === 4) return { w: 2, h: 2 };",
  },
  {
    name: "#99 a crate that asks for no tablet gets one",
    file: F("cargo.js"),
    from: "  if (typeof Chips !== 'undefined' && !opts.noTablet\n",
    to:   "  if (typeof Chips !== 'undefined'\n",
  },
  {
    name: "#99 the wreck tablet goes by the richer cargo sector",
    file: F("cargo.js"),
    from: "    g.add(Chips.rollDrop(opts.tabletSector ?? sector));",
    to:   "    g.add(Chips.rollDrop(sector));",
  },
  {
    name: "#99 every salvage crate rolls its own tablet",
    file: F("game.js"),
    from: "        cols: 3, rows: 3, tries: Utils.randIn(1, 2 + big), noTablet: true,",
    to:   "        cols: 3, rows: 3, tries: Utils.randIn(1, 2 + big),",
  },
  {
    name: "#99 the first boss pays II-III again",
    file: F("game.js"),
    from: "    return _awardChip(apophis ? { minLevel: 3, maxLevel: 4 } : { minLevel: 1, maxLevel: 2 },",
    to:   "    return _awardChip(apophis ? { minLevel: 3, maxLevel: 4 } : { minLevel: 2, maxLevel: 3 },",
  },
  {
    name: "#99 the Book does not pause the fight",
    file: F("game.js"),
    from: "    _update(_paused || _B().open ? 0 : dt);",
    to:   "    _update(_paused ? 0 : dt);",
  },
  {
    name: "#99 B does nothing in a fight",
    file: F("game.js"),
    from: "    if (_bookKey()) return;\n    if (_B().open) { _updateBook('combat'); return; }",
    to:   "    if (_B().open) { _updateBook('combat'); return; }",
  },
  {
    name: "#99 a right click uses a tablet instead of moving it",
    file: F("game.js"),
    from: "        if (right) {\n          const on = Chips.toggleQuick(_commander, card.key);",
    to:   "        if (false) {\n          const on = Chips.toggleQuick(_commander, card.key);",
  },
  {
    name: "#99 the Golden Ratio does not need a pilot",
    file: F("game.js"),
    from: "          if (!_playerShip || _playerShip.evasion <= 0) {",
    to:   "          if (!_playerShip) {",
  },
  {
    name: "#99 the Was strikes a wreck",
    file: F("game.js"),
    from: "          if (!foe || foe.destroyed || foe.hull <= 0 || foe.isDerelict || !foe.reactor) {",
    to:   "          if (!foe || !foe.reactor) {",
  },
  {
    name: "#99 ME heals nobody",
    file: F("game.js"),
    from: "          crew.forEach(c => { c.hp = Math.min(c.maxHp, c.hp + heal); });\n",
    to:   "",
  },
  {
    name: "#99 ME IV mends nothing",
    file: F("game.js"),
    from: "          if (worst) { worst.damagedLevels--; worst.repairProgress = 0; }\n",
    to:   "",
  },
  {
    name: "#99 an ME with nothing to do is paid for",
    file: F("game.js"),
    from: "          if (!crew.length && !fixO2 && !worst) {",
    to:   "          if (false) {",
  },
  {
    name: "#99 the tablet button does nothing",
    file: F("game.js"),
    from: "      if (z.tablet)       { _useTablet(z.tablet, STATE === 'combat' ? 'combat' : 'map'); return true; }\n",
    to:   "",
  },
  {
    name: "#99 the BOOK button does nothing",
    file: F("game.js"),
    from: "      if (z.bookOpen)     { if (_commander) { _B().open = true; Audio.sfx.uiClick?.(); } return true; }\n",
    to:   "",
  },
  {
    name: "#99 tablets never tick in a fight",
    file: F("game.js"),
    from: "    Chips?.tick?.(dt);              // …and the tablets in use (update99)\n",
    to:   "",
  },
  {
    name: "#99 a new fight keeps last fight's tablets running",
    file: F("game.js"),
    from: "    Chips?.resetRunning?.();        // a new fight: no tablet still running (update99)\n",
    to:   "",
  },
  {
    name: "#99 the quick bar is not clickable",
    file: F("renderer.js"),
    from: "      _powerClickZones.push({ ...sl, tablet: t.key });\n",
    to:   "",
  },
  {
    name: "#99 the BOOK button is not clickable",
    file: F("renderer.js"),
    from: "    _powerClickZones.push({ ...bk, bookOpen: true });\n",
    to:   "",
  },
  {
    name: "#99 the tablet tip always says READY",
    file: F("renderer.js"),
    from: "    const state = no ? _wrap(ctx, no, TW - 16) : ['READY'];",
    to:   "    const state = ['READY'];",
  },
  {
    name: "#99 the Book's cards are not clickable",
    file: F("renderer.js"),
    from: "        out.cards.push({ kind: 'tablet', key: t.key, ...r });\n",
    to:   "",
  },
  {
    name: "#99 the Book ignores its tabs",
    file: F("renderer.js"),
    from: "      const list = Chips.tablets(cap).filter(t => tab === 'all' || t.def.family === tab);",
    to:   "      const list = Chips.tablets(cap);",
  },
  {
    name: "#99 the Book does not say the fight waits",
    file: F("renderer.js"),
    from: "      ctx.fillText('THE FIGHT IS PAUSED', px + PW - 20, py + 42);\n",
    to:   "",
  },
  {
    name: "#99 the dossier shows a level with no tablet",
    file: F("renderer.js"),
    from: "        ctx.fillText(`${g} ${Chips.roman(it.def.chipLevel ?? 1)}`, cx + w / 2, cy + h / 2 + 3);",
    to:   "        ctx.fillText(Chips.roman(it.def.chipLevel ?? 1), cx + w / 2, cy + h / 2 + 3);",
  },
  {
    name: "#99 a karma warning counts only the wall",
    file: F("commander.js"),
    from: "    const working = (c) => Chips.tablets(c).filter(t => t.eff > 0).length;",
    to:   "    const working = (c) => Chips.live(c).length;",
  },
  {
    name: "#99 the board names no dark tablet but a wall-struck one",
    file: F("lootscreen.js"),
    from: "      const dead = g.items.filter(it => Chips.itemLevel(cap, it) <= 0);",
    to:   "      const dead = g.items.filter(it => Chips.isInert(cap, it));",
  },
  {
    name: "#99 the Golden Ratio adds no evasion",
    file: F("ship.js"),
    from: "    return Utils.clamp((pilotPct + engPct + cloakPct + skillPct + engSkill + order + tablet) * slow,",
    to:   "    return Utils.clamp((pilotPct + engPct + cloakPct + skillPct + engSkill + order) * slow,",
  },
  {
    name: "#99 the Golden Ratio IV does not charge the shields",
    file: F("systems.js"),
    from: "                                     / (1 + (this._tabletCharge || 0)));",
    to:   "                                     );",
  },
  {
    name: "#99 their reactor ignores the Was",
    file: F("systems.js"),
    // Re-aimed in update101 (the Djed boost joined the line).
    from: "    return Math.max(0, this.capacity - dmg - this.penalty - (this.drain || 0))\n         + this.cyborgBonus + (this.boost || 0);\n  }\n\n  /** Live output",
    to:   "    return Math.max(0, this.capacity - dmg - this.penalty)\n         + this.cyborgBonus + (this.boost || 0);\n  }\n\n  /** Live output",
  },
  {
    name: "#99 the old chips stay in the catalogue",
    file: F("cargo.js"),
    from: "const TABLET_VALUE = [60, 120, 240, 480];",
    to:   "const TABLET_VALUE = [60, 120, 240, 480];\nCARGO_ITEMS.chip_mobility_1 = { label: 'Mobility I', short: 'CHIP', w: 1, h: 1, col: '#b8c4d4', kind: 'chip', value: 40 };",
  },
  /* ── update100: asteroid fields (package C). ── */
  {
    name: "#100 no asteroid field on any map",
    file: F("map.js"),
    from: "  asteroids:{ label: 'Asteroids', color: '#c08a52', icon: '◆',  weight: 1 },",
    to:   "  asteroids:{ label: 'Asteroids', color: '#c08a52', icon: '◆',  weight: 0 },",
  },
  {
    name: "#100 an asteroid node never holds a fight",
    file: F("game.js"),
    from: "      if (Math.random() < ASTEROID_FIGHT_ODDS) {",
    to:   "      if (false) {",
  },
  {
    name: "#100 the asteroid node's fight has no field",
    file: F("game.js"),
    from: "        _startCombat('normal', false, { canSurprise: true, asteroids: true });",
    to:   "        _startCombat('normal', false, { canSurprise: true });",
  },
  {
    name: "#100 _startCombat forgets the field",
    file: F("game.js"),
    from: "    if (opts.asteroids) {\n      CombatManager.startAsteroidField();",
    to:   "    if (false) {\n      CombatManager.startAsteroidField();",
  },
  {
    name: "#100 a new fight keeps the last field",
    file: F("combat.js"),
    from: "    /* No field until the fight says so (`startAsteroidField`). */\n    this.asteroids = null;\n",
    to:   "",
  },
  {
    name: "#100 the field outlives its fight",
    file: F("combat.js"),
    from: "    this.asteroids    = null;           // the field ends with the fight\n",
    to:   "",
  },
  {
    name: "#100 a rock comes with no warning",
    file: F("combat.js"),
    from: "    if (!A.warn && A.t <= ASTEROID.WARN) A.warn = this._pickRockTarget();\n",
    to:   "",
  },
  {
    name: "#100 the rock ignores the room it warned",
    file: F("combat.js"),
    from: "    const w = A.warn || this._pickRockTarget();",
    to:   "    const w = this._pickRockTarget();",
  },
  {
    name: "#100 a rock is somebody's shot",
    file: F("combat.js"),
    from: "    p.fromField = true;            // a rock is nobody's shot (Ship.receiveHit)\n",
    to:   "",
  },
  {
    name: "#100 a rock resets the enemy's 60-second clock",
    file: F("ship.js"),
    from: "    if (this.isPlayer && !proj.fromField && (dmg > 0 || (roomHit.system && modDmg > 0) ||",
    to:   "    if (this.isPlayer && (dmg > 0 || (roomHit.system && modDmg > 0) ||",
  },
  {
    name: "#100 rocks keep falling after the fight is won",
    file: F("combat.js"),
    from: "      case COMBAT_STATE.VICTORY:",
    to:   "      case COMBAT_STATE.VICTORY: this._updateAsteroids(dt);",
  },
  {
    name: "#100 the coming rock is not shown",
    file: F("game.js"),
    from: "    _drawRockWarning(ctx);\n",
    to:   "",
  },
  {
    name: "#100 a dead hull is a rock target",
    file: F("combat.js"),
    from: "    if (this.enemyShip && !this.enemyShip.destroyed && this.enemyShip.hull > 0) sides.push('enemy');",
    to:   "    if (this.enemyShip) sides.push('enemy');",
  },
  {
    name: "#100 every rock falls on us",
    file: F("combat.js"),
    from: "  PLAYER_SHARE: 0.5,         // the rock falls on us half the time",
    to:   "  PLAYER_SHARE: 1.0,         // the rock falls on us half the time",
  },
  {
    name: "#100 a rock goes through the bubble",
    file: F("combat.js"),
    from: "    pierceShields: false, breachChance: 0.3, crewDamage: [5, 15],",
    to:   "    pierceShields: true, breachChance: 0.3, crewDamage: [5, 15],",
  },
  {
    name: "#100 the field draws no rocks behind the fight",
    file: F("game.js"),
    from: "    if (CombatManager.asteroids) Renderer.drawAsteroidField(ctx, _prevTime * 0.001);\n",
    to:   "",
  },
  /* ── update101: package D (Absolute Zero, Westcar, Eye of Horus, Djed). ── */
  {
    name: "#101 Absolute Zero does not cool the core",
    file: F("game.js"),
    from: "          sh.reactorHeat = Math.max(0, heat - def.cool[eff - 1]);",
    to:   "          sh.reactorHeat = heat;",
  },
  {
    name: "#101 Absolute Zero II puts out one fire",
    file: F("game.js"),
    from: "            live.slice().sort((a, b) => b.intensity - a.intensity).slice(0, how).forEach(douse);",
    to:   "            live.slice().sort((a, b) => b.intensity - a.intensity).slice(0, 1).forEach(douse);",
  },
  {
    name: "#101 Absolute Zero III picks the wrong module",
    file: F("game.js"),
    from: "            const worst = [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];",
    to:   "            const worst = live[live.length - 1]?.roomId;",
  },
  {
    name: "#101 Absolute Zero IV leaves fires burning",
    file: F("game.js"),
    from: "          if (how === 'all') live.forEach(douse);",
    to:   "          if (how === 'all') live.slice(0, 1).forEach(douse);",
  },
  {
    name: "#101 Absolute Zero IV gives no window without fire",
    file: F("game.js"),
    from: "          if (def.noIgnite[eff - 1] > 0) sh.fires.noIgniteT = def.noIgnite[eff - 1];\n",
    to:   "",
  },
  {
    name: "#101 a fire catches in the no-fire window",
    file: F("fire.js"),
    from: "    if ((this.noIgniteT ?? 0) > 0) return null;\n",
    to:   "",
  },
  {
    name: "#101 the no-fire window never closes",
    file: F("fire.js"),
    from: "    if (this.noIgniteT > 0) this.noIgniteT = Math.max(0, this.noIgniteT - dt);\n",
    to:   "",
  },
  {
    name: "#101 Absolute Zero is paid for with nothing to do",
    file: F("game.js"),
    from: "          if (heat <= 0 && !live.length) {",
    to:   "          if (false) {",
  },
  {
    name: "#101 Westcar works outside an asteroid field",
    file: F("chips.js"),
    from: "    if (def.where === 'asteroids'\n        && !(where === 'combat' && typeof CombatManager !== 'undefined' && CombatManager.asteroids)) {",
    to:   "    if (false) {",
  },
  {
    name: "#101 Westcar folds nothing",
    file: F("combat.js"),
    from: "      if (p.fromField && !p.fromPlayer && typeof Chips !== 'undefined' && Chips.running('westcar')) {",
    to:   "      if (false) {",
  },
  {
    name: "#101 Westcar folds their rocks too",
    file: F("combat.js"),
    from: "      if (p.fromField && !p.fromPlayer && typeof Chips !== 'undefined' && Chips.running('westcar')) {",
    to:   "      if (p.fromField && typeof Chips !== 'undefined' && Chips.running('westcar')) {",
  },
  {
    name: "#101 the Eye I is paid for against a ship with no cloak",
    file: F("game.js"),
    from: "          if (eff === 1 && !cl) {",
    to:   "          if (false) {",
  },
  {
    name: "#101 the Eye leaves their cloak on",
    file: F("game.js"),
    from: "            cl.cloakActive = false; cl.cloakTimer = 0;",
    to:   "            void 0;",
  },
  {
    name: "#101 they cloak under the Eye",
    file: F("combat.js"),
    from: "      if (cl && cl.cloakReady && !watched) {",
    to:   "      if (cl && cl.cloakReady) {",
  },
  {
    name: "#101 their aim is never marked",
    file: F("game.js"),
    from: "    ctx.fillText('◉ THEIR AIM', room.cx, room.y + 12);\n",
    to:   "",
  },
  {
    name: "#101 the Eye III does not count their guns",
    file: F("game.js"),
    from: "    if (lvl >= 3) {\n      const lines = (_enemyShip.weapons ?? [])",
    to:   "    if (lvl >= 4) {\n      const lines = (_enemyShip.weapons ?? [])",
  },
  {
    name: "#101 a running tablet has no level",
    file: F("chips.js"),
    from: "  function runningLevel(key) { return _run[key]?.lvl ?? 0; }",
    to:   "  function runningLevel(key) { return 0; }",
  },
  {
    name: "#101 the Djed adds no power",
    file: F("game.js"),
    from: "          sh.reactor.boost = def.power[eff - 1];\n",
    to:   "",
  },
  {
    name: "#101 the reactor ignores the Djed",
    file: F("systems.js"),
    from: "         + this.cyborgBonus + (this.boost || 0);",
    to:   "         + this.cyborgBonus;",
  },
  {
    name: "#101 the Djed costs no heat",
    file: F("game.js"),
    from: "          sh.reactorHeat = Math.min(100, (sh.reactorHeat ?? 0) + def.heat[eff - 1]);\n",
    to:   "",
  },
  {
    name: "#101 the Djed heat runs past 100",
    file: F("game.js"),
    from: "          sh.reactorHeat = Math.min(100, (sh.reactorHeat ?? 0) + def.heat[eff - 1]);",
    to:   "          sh.reactorHeat = (sh.reactorHeat ?? 0) + def.heat[eff - 1];",
  },
  {
    name: "#101 the Djed's units outlive its clock",
    file: F("chips.js"),
    from: "    if (key === 'djed' && r.ship?.reactor) r.ship.reactor.boost = 0;\n",
    to:   "",
  },
  {
    name: "#101 the Djed's clock stands still in flight",
    file: F("game.js"),
    from: "    // Tablets used in flight run their clocks here too (update101: the Djed).\n    Chips?.tick?.(dt);\n",
    to:   "",
  },
  {
    name: "#101 the Djed's clock does not know whose core",
    file: F("game.js"),
    from: "    const holder = key === 'was' ? _enemyShip : key === 'djed' ? _playerShip : null;",
    to:   "    const holder = key === 'was' ? _enemyShip : null;",
  },
  {
    name: "#102 the Tablet of Destinies is not wired",
    file: F("chips.js"),
    from: "tag: 'MYTHOLOGICAL MOTIF', where: 'combat', live: true,",
    to:   "tag: 'MYTHOLOGICAL MOTIF', where: 'combat', live: false, pkg: 'E',",
  },
  {
    name: "#102 Destinies lets a missile land",
    file: F("combat.js"),
    from: "&& (p.type === 'missile' || p.type === 'torpedo')\n",
    to:   "&& (p.type === 'torpedo')\n",
  },
  {
    name: "#102 Destinies lets a torpedo land",
    file: F("combat.js"),
    from: "&& (p.type === 'missile' || p.type === 'torpedo')\n",
    to:   "&& (p.type === 'missile')\n",
  },
  {
    name: "#102 Destinies stops lasers too",
    file: F("combat.js"),
    from: "&& (p.type === 'missile' || p.type === 'torpedo')\n",
    to:   "&& (p.type === 'missile' || p.type === 'torpedo' || p.type === 'laser')\n",
  },
  {
    name: "#102 Destinies never runs out",
    file: F("combat.js"),
    from: "          && typeof Chips !== 'undefined' && Chips.running('destinies')) {",
    to:   "          && typeof Chips !== 'undefined') {",
  },
  {
    name: "#102 Destinies is paid for against plain guns",
    file: F("game.js"),
    from: "          if (!heavy) {",
    to:   "          if (false) {",
  },
  {
    name: "#102 Destinies lasts the wrong time",
    file: F("chips.js"),
    from: "    secs: [3, 5, 7, 12],",
    to:   "    secs: [5, 5, 7, 12],",
  },
  {
    name: "#102 the Foundation Cone is not wired",
    file: F("chips.js"),
    from: "tag: 'CONFIRMED ARTEFACT, FICTIONAL USE', where: 'combat', live: true,",
    to:   "tag: 'CONFIRMED ARTEFACT, FICTIONAL USE', where: 'combat', live: false, pkg: 'E',",
  },
  {
    name: "#102 the Cone does not hold their drive",
    file: F("combat.js"),
    from: "      } else if (typeof Chips !== 'undefined' && Chips.running('cone')) {",
    to:   "      } else if (false) {",
  },
  {
    name: "#102 the Cone throws away their charge",
    file: F("combat.js"),
    from: "           no further while it holds, but keeps what it had. */",
    to:   "           no further while it holds, but keeps what it had. */ this._enemyEscapeT = 0;",
  },
  {
    name: "#102 the Cone is paid for on a wreck",
    file: F("game.js"),
    from: "          if (foe.isDerelict || foe.layout?.grounded || boss) {",
    to:   "          if (foe.layout?.grounded || boss) {",
  },
  {
    name: "#102 the Cone is paid for on the ground",
    file: F("game.js"),
    from: "          if (foe.isDerelict || foe.layout?.grounded || boss) {",
    to:   "          if (foe.isDerelict || boss) {",
  },
  {
    name: "#102 the Cone lasts the wrong time",
    file: F("chips.js"),
    from: "    secs: [5, 8, 11, 18],",
    to:   "    secs: [8, 8, 11, 18],",
  },
  {
    name: "#102 the escape bar never says ANCHORED",
    file: F("game.js"),
    from: "      const anchored = typeof Chips !== 'undefined' && Chips.running('cone');",
    to:   "      const anchored = false;",
  },
  {
    name: "#102 the hull marker never says ANCHORED",
    file: F("game.js"),
    // update127: the marker over the hull is gone; the BAR says it now
    from: "      ctx.fillText(anchored ? 'FTL ANCHORED' : 'ENEMY FTL', ex + 30, ey + 10);",
    to:   "      ctx.fillText('ENEMY FTL', ex + 30, ey + 10);",
  },
  {
    name: "#102 the VA 243 Seal is not wired",
    file: F("chips.js"),
    from: "    tag: 'CONFIRMED ARTEFACT; \"solar system map\" UNCONFIRMED', where: 'map', live: true,",
    to:   "    tag: 'CONFIRMED ARTEFACT; \"solar system map\" UNCONFIRMED', where: 'map', live: false, pkg: 'E',",
  },
  {
    name: "#102 a node the seal showed stays fogged",
    file: F("map.js"),
    from: "    if (this.seen?.has(node.id)) return 'known';\n",
    to:   "",
  },
  {
    name: "#102 a bad roll shows nothing",
    file: F("map.js"),
    from: "    if (!got.length) got = [hidden[Math.floor(rand() * hidden.length) % hidden.length]];\n",
    to:   "",
  },
  {
    name: "#102 the seal's roll is upside down",
    file: F("map.js"),
    from: "    let got = hidden.filter(() => rand() < chance);",
    to:   "    let got = hidden.filter(() => rand() >= chance);",
  },
  {
    name: "#102 the seal's nodes are not saved",
    file: F("map.js"),
    from: "      seen:      [...(this.seen ?? [])],",
    to:   "      seen:      [],",
  },
  {
    name: "#102 the seal's nodes are not restored",
    file: F("map.js"),
    from: "    (Array.isArray(p.seen) ? p.seen : []).forEach(id => { if (this.getNode(id)) this.seen.add(id); });\n",
    to:   "",
  },
  {
    name: "#102 the seal is paid for with nothing hidden",
    file: F("game.js"),
    from: "          if (!got.length) {\n            UI.notify('VA 243 Seal",
    to:   "          if (false) {\n            UI.notify('VA 243 Seal",
  },
  {
    name: "#102 the seal at IV leaves some hidden",
    file: F("chips.js"),
    from: "    chance: [0.2, 0.4, 0.6, 1],",
    to:   "    chance: [0.2, 0.4, 0.6, 0.6],",
  },
  {
    name: "#103 Re-Atum does not answer hull 0 in a fight",
    file: F("game.js"),
    from: "    if (CombatManager.isDefeat()) { if (!_reAtumRescue('hull')) _onLose(); return; }",
    to:   "    if (CombatManager.isDefeat()) { _onLose(); return; }",
  },
  {
    name: "#103 Re-Atum does not answer hull 0 on the map",
    file: F("game.js"),
    from: "        if (crewAlive && _reAtumRescue('hull')) return;\n",
    to:   "",
  },
  {
    name: "#103 Re-Atum rescues without the Knowledge",
    file: F("chips.js"),
    from: "    if (have < cost) return `Re-Atum needs ${cost} knowledge (${Math.floor(have)} left).`;\n",
    to:   "",
  },
  {
    name: "#103 the rescue is free",
    file: F("game.js"),
    from: "    if (!Commander.spendKnowledge(cap, Chips.costOf('re_atum', eff))) return false;",
    to:   "    if (false) return false;",
  },
  {
    name: "#103 Re-Atum is not spent by the rescue",
    file: F("game.js"),
    from: "    if (flown) board.remove(flown);\n    Chips.commit(cap, board);\n\n    // Who gets a seat",
    to:   "    Chips.commit(cap, board);\n\n    // Who gets a seat",
  },
  {
    name: "#103 nobody gets a seat",
    file: F("game.js"),
    from: "    const seats = def.crew[eff - 1];",
    to:   "    const seats = 0;",
  },
  {
    name: "#103 everybody gets a seat",
    file: F("game.js"),
    from: "    const seats = def.crew[eff - 1];",
    to:   "    const seats = Infinity;",
  },
  {
    name: "#103 the scrap does not come home",
    file: F("game.js"),
    from: "    const cc = Math.floor((run?.scrap ?? 0) * def.scrap[eff - 1]);",
    to:   "    const cc = 0;",
  },
  {
    name: "#103 the scrap is rounded up",
    file: F("game.js"),
    from: "    const cc = Math.floor((run?.scrap ?? 0) * def.scrap[eff - 1]);",
    to:   "    const cc = Math.ceil((run?.scrap ?? 0) * def.scrap[eff - 1]);",
  },
  {
    name: "#103 IV brings no copy",
    file: F("game.js"),
    from: "        if (shelf.autoPlace(item)) { Base.commitWarehouse(shelf); copied = item.def.label ?? pick.defKey; }",
    to:   "        if (shelf.autoPlace(item)) { copied = item.def.label ?? pick.defKey; }",
  },
  {
    name: "#103 karma is taken even when nobody is left",
    file: F("game.js"),
    from: "    if (left > 0 && typeof Commander !== 'undefined') {",
    to:   "    if (typeof Commander !== 'undefined') {",
  },
  {
    name: "#103 karma is never taken",
    file: F("game.js"),
    from: "    if (left > 0 && typeof Commander !== 'undefined') {",
    to:   "    if (false) {",
  },
  {
    name: "#103 the rescued commander is buried anyway",
    file: F("game.js"),
    from: "    _commander = null;          // so _onLose does not bury him as well\n    Commander?.setActive?.(null);\n    _onLose();\n    return true;",
    to:   "    Commander?.setActive?.(null);\n    _onLose();\n    return true;",
  },
  {
    name: "#103 the pod starts without the Knowledge",
    file: F("game.js"),
    from: "    if (no) { UI.notify(no, 'warn'); return false; }\n    _evacT = secs;",
    to:   "    _evacT = secs;",
  },
  {
    name: "#103 the pod by hand loses the run the old way",
    file: F("game.js"),
    from: "    if (!_reAtumRescue('pod')) _onLose();",
    to:   "    _onLose();",
  },
  {
    name: "#103 the rescue table is wrong",
    file: F("chips.js"),
    from: "crew: [0, 1, 2, Infinity], scrap: [0, 0.10, 0.25, 0.50]",
    to:   "crew: [0, 1, 2, Infinity], scrap: [0, 0.10, 0.20, 0.50]",
  },
  /* ── update104: jj's list from play (part 1). ── */
  {
    name: "#104 the gravity rides a cyborg's +1 again",
    file: F('ship.js'),
    from: "    const fed = Math.min(e.power, e.workingLevels) - (e.ionDamage > 0 ? e.ionDamage : 0);\n    return fed >= 1;",
    to:   "    return e.effectivePower() >= 1;",
  },
  {
    name: "#104 the base opens on the remembered contract",
    file: F('basescreen.js'),
    from: "    _mission = (Base.missions().find(m =>",
    to:   "    _mission = b.lastMission || (Base.missions().find(m =>",
  },
  {
    name: "#104 HEAL green again",
    file: F('renderer.js'),
    from: "                    heal: '#4db8ff' };",
    to:   "                    heal: '#1aff8c' };",
  },
  {
    name: "#104 FEED grey again",
    file: F('renderer.js'),
    from: "                    feed: '#1aff8c', cell: '#4db8ff',",
    to:   "                    feed: '#8fa8c0', cell: '#4db8ff',",
  },
  {
    name: "#104 CPU on the commander's board screen",
    file: F('game.js'),
    from: "title: `DESTINY TABLETS — ${cap.name}`,",
    to:   "title: `CPU BOARD — ${cap.name}`,",
  },
  {
    name: "#104 CPU in the Book's empty line",
    file: F('renderer.js'),
    from: "'No Destiny Tablets mounted. Mount them at base: MESS → DESTINY TABLETS.'",
    to:   "'No tablets on his CPU board. Mount them at base: MESS → CPU.'",
  },
  {
    name: "#104 Absolute Zero says -10 again",
    file: F('chips.js'),
    from: "    levels: ['-130 °C on the reactor, puts out 1 fire',",
    to:   "    levels: ['-10 reactor heat, puts out 1 fire',",
  },
  {
    name: "#104 Absolute Zero IV degrees wrong",
    file: F('chips.js'),
    from: "'-780 °C, every fire aboard, 5 s with no new fire'",
    to:   "'-60 °C, every fire aboard, 5 s with no new fire'",
  },
  {
    name: "#104 ruined contraband sells at 40%",
    file: F('cargo.js'),
    from: "    if (this.damaged && this.def.contraband) return 0;\n",
    to:   "",
  },
  {
    name: "#104 ruined contraband: the port says nothing",
    file: F('cargo.js'),
    from: "    if (this.damaged && this.def.contraband) return 'ruined contraband — the seal is broken, nobody buys it';\n",
    to:   "",
  },
  {
    name: "#104 the commander bar in a fight only",
    file: F('renderer.js'),
    from: "    return typeof Commander !== 'undefined'\n      && !!Commander.active && !!Commander.active();\n  }",
    to:   "    return !!state.enemyShip && typeof Commander !== 'undefined'\n      && !!Commander.active && !!Commander.active();\n  }",
  },
  {
    name: "#104 the old strip's corner back above the crew",
    file: F('renderer.js'),
    from: "    const b = commanderBarRects().bar;\n    return { x: b.x + 4, y: b.y + 4, w: 84, h: 28 };",
    to:   "    return { x: 14, y: 84, w: 120, h: 20 };",
  },
  {
    name: "#104 the old strip drawn again",
    file: F('renderer.js'),
    from: "       face, his name, the dossier click and the pod. */\n",
    to:   "       face, his name, the dossier click and the pod. */\n    if (typeof Commander !== 'undefined' && Commander.active && Commander.active()) { const cap = Commander.active(); ctx.fillText(`${String(cap.name).slice(0, 7)} L${cap.level}`, 35, 93); }\n",
  },
  {
    name: "#104 special orders look live on the map",
    file: F('renderer.js'),
    from: "      const live = has && !used && afford && inFight;",
    to:   "      const live = has && !used && afford;",
  },
  {
    name: "#104 the map buttons under the bar",
    file: F('game.js'),
    from: "    return 300 + 615 + 10;",
    to:   "    return 300 + 160;",
  },
  {
    name: "#104 Re-Atum's card back to 'not used by hand'",
    file: F('renderer.js'),
    from: "        if (pas) {                      // update104",
    to:   "        if (false) {                      // update104",
  },
  {
    name: "#104 Re-Atum's card: READY with no Knowledge",
    file: F('chips.js'),
    from: "    const no = rescueRefusal(cap);\n    if (!no) return { ready: true,",
    to:   "    const no = null;\n    if (!no) return { ready: true,",
  },
  {
    name: "#104 an interrupted repair keeps its bar",
    file: F('systems.js'),
    from: "    else if (this.repairProgress > 0) this.repairProgress = 0;\n",
    to:   "",
  },
  {
    name: "#104 a repair resets with no grace",
    file: F('systems.js'),
    from: "    if (this._repairHold > 0) this._repairHold = Math.max(0, this._repairHold - dt);\n    /* AN INTERRUPTED",
    to:   "    if (this._repairHold > 0) this._repairHold = 0;\n    /* AN INTERRUPTED",
  },
  {
    name: "#104 a half patch on a breach is kept",
    file: F('breach.js'),
    from: "    else if (this.progress > 0) this.progress = 0;\n",
    to:   "",
  },
  /* ── update105: jj's list from play (part 2: fight and boarding). ── */
  {
    name: "#105 an open door is hacked again",
    file: F('crew.js'),
    from: "            if (door.mode === 'open' && door.open) {",
    to:   "            if (false) {",
  },
  {
    name: "#105 their boarders thrown out when their hull goes",
    file: F('game.js'),
    from: "    if (!opts.keepIntruders) _purgeIntruders();",
    to:   "    _purgeIntruders();",
  },
  {
    name: "#105 their pod vanishes with their hull",
    file: F('game.js'),
    from: "    if (opts.keepIntruders && _enemyParty) {",
    to:   "    if (false) {",
  },
  {
    name: "#105 the man on their deck flies on anyway",
    file: F('game.js'),
    from: "          m.phase = 'cancelled';\n          if (!m.c.dead) m.c.killOutright('went down with their ship');\n",
    to:   "",
  },
  {
    name: "#105 the enemy-down sweep keeps nobody",
    file: F('game.js'),
    from: "_recoverBoarders({ aboardLost: 'went down with the enemy ship', keepIntruders: true });",
    to:   "_recoverBoarders({ aboardLost: 'went down with the enemy ship' });",
  },
  {
    name: "#105 a searched hull is not marked",
    file: F('game.js'),
    from: "      her._searched = true;",
    to:   "      her._searched = false;",
  },
  {
    name: "#105 crates drift out after a search",
    file: F('game.js'),
    from: "    if (!e || BossManager.isActive || e.isDerelict || e._searched) return null;",
    to:   "    if (!e || BossManager.isActive || e.isDerelict) return null;",
  },
  {
    name: "#105 her hold is not in the search",
    file: F('game.js'),
    from: "      (her.cargo?.items ?? []).forEach(it => wreck.add(",
    to:   "      ([]).forEach(it => wreck.add(",
  },
  {
    name: "#105 her gun is not in the search",
    file: F('game.js'),
    from: "      const gun = CombatManager.weaponDrop;\n      if (gun) {\n        CombatManager.weaponDrop = null;\n        const box",
    to:   "      const gun = null;\n      if (gun) {\n        CombatManager.weaponDrop = null;\n        const box",
  },
  {
    name: "#105 the search as lean as before",
    file: F('game.js'),
    from: "tries: Utils.randIn(5, 8 + Math.floor(sector / 2)) }",
    to:   "tries: Utils.randInt(2, 4 + Math.floor(sector / 2)) }",
  },
  {
    name: "#105 her hold no bigger",
    file: F('game.js'),
    from: "    const sizeUp = her ? 1 : 0;",
    to:   "    const sizeUp = 0;",
  },
  {
    name: "#105 the reactor console does nothing",
    file: F('ship.js'),
    from: "    return this.consoleOperator(sys.roomId) ? REACTOR_HEAT_CONFIG.consoleCoolPerSec : 0;",
    to:   "    return 0;",
  },
  {
    name: "#105 anybody in the reactor room cools it",
    file: F('ship.js'),
    from: "    return this.consoleOperator(sys.roomId) ? REACTOR_HEAT_CONFIG.consoleCoolPerSec : 0;",
    to:   "    return this.crewOperating(sys.roomId).length ? REACTOR_HEAT_CONFIG.consoleCoolPerSec : 0;",
  },
  {
    name: "#105 the console cools a lot",
    file: F('ship.js'),
    from: "  consoleCoolPerSec: 0.1,",
    to:   "  consoleCoolPerSec: 0.5,",
  },
  {
    name: "#105 the cloak the same at every level",
    file: F('systems.js'),
    from: "    cloakLevels: [{ dur: 6, cd: 22 }, { dur: 10, cd: 30 }],",
    to:   "    cloakLevels: [{ dur: 6, cd: 22 }, { dur: 6, cd: 22 }],",
  },
  {
    name: "#105 the cloak keeps its charge through the dark",
    file: F('systems.js'),
    from: "        this._cloakDark = false;\n        this.cloakCd = this.cloakRecharge();",
    to:   "        this._cloakDark = false;",
  },
  {
    name: "#105 a collapsed cloak shows no recharge",
    file: F('systems.js'),
    from: "        this.cloakCd = this.cloakRecharge();   // shown empty while dark\n",
    to:   "",
  },
  {
    name: "#105 a dark cloak reads its seconds, not NO PWR",
    file: F('renderer.js'),
    from: "        } else if (disabled) {\n          subLabel = 'NO PWR';          // dark: its charge is lost (update105)\n",
    to:   "        } else if (false) {\n",
  },
  /* ── update106: jj's list from play (part 3: decision windows). ── */
  {
    name: "#106 a handed-over gun is lost to a full hold",
    file: F('game.js'),
    from: "        _queueWeaponLocker(result.weaponReward);\n        UI.notify(`${label} — the hold is full: make room for it`, 'warn');",
    to:   "        UI.notify(`${label} would not fit — the hold is full, and they kept it`, 'warn');",
  },
  {
    name: "#106 the barracks turns people away again",
    file: F('game.js'),
    from: "      if (over > 0) {\n        _openDismiss(",
    to:   "      if (false) {\n        _openDismiss(",
  },
  /* (#106 "dismissing ignores the count" dropped: `_applyDismiss` is only reached
     through `_updateDismiss`, which already asks — a second guard no test can see.) */
  {
    name: "#106 more can be marked than must go",
    file: F('game.js'),
    from: "        if (row.pick || _dismissCount() < _dismiss.need) { row.pick = !row.pick;",
    to:   "        if (true) { row.pick = !row.pick;",
  },
  {
    name: "#106 a dismissed hand at the base stays",
    file: F('game.js'),
    from: "      if (r.home) Base.removeCrew(r.who.id);",
    to:   "      if (r.home) { /* kept */ }",
  },
  {
    name: "#106 a dismissed hand coming home comes in anyway",
    file: F('game.js'),
    from: "      else if (_playerShip) _playerShip.crew = _playerShip.crew.filter(c => c !== r.who);",
    to:   "      else if (_playerShip) { /* kept */ }",
  },
  {
    name: "#106 docking stuck on the dismiss screen",
    file: F('game.js'),
    from: "    STATE = d.back;                 // docking carries on",
    to:   "    // STATE = d.back;                 // docking carries on",
  },
  {
    name: "#106 no window for what an event did",
    file: F('game.js'),
    from: "    if (STATE === 'map' && !_event) {\n      const diff = _outcomeDiff(",
    to:   "    if (false) {\n      const diff = _outcomeDiff(",
  },
  {
    name: "#106 the event window takes no input",
    file: F('game.js'),
    from: "    if (_updateEventResult()) return;\n",
    to:   "",
  },
  {
    name: "#106 the event window cannot be closed",
    file: F('game.js'),
    from: "    if (hit || Input.isPressed('Enter') || Input.isPressed('Escape')) {\n      _eventResult = null;",
    to:   "    if (hit || Input.isPressed('Escape')) {\n      _eventResult = null;",
  },
  {
    name: "#106 the event window is never drawn",
    file: F('game.js'),
    from: "    if (STATE === 'map') _drawEventResult(ctx);       // update106",
    to:   "    // if (STATE === 'map') _drawEventResult(ctx);       // update106",
  },
  {
    name: "#106 the event window forgets the choice",
    file: F('game.js'),
    from: "      ctx.fillText(`You chose: ${_eventResult.choice}`.slice(0, 60), tx, y);",
    to:   "      ctx.fillText('', tx, y);",
  },
  /* ── update107: jj's list from play (part 4: people and crates). ── */
  {
    name: "#107 the suit stops while the crate is open",
    file: F('game.js'),
    from: "    if (_lootReturn === 'combat' && CombatManager.salvage) _salvageLootTick(dt);\n",
    to:   "",
  },
  {
    name: "#107 the crate window has no air clock",
    file: F('game.js'),
    from: "      seconds: Math.max(3, m.c.air ?? 0),\n",
    to:   "",
  },
  {
    name: "#107 the crate window outlives the man at it",
    file: F('game.js'),
    from: "        LootScreen.forceClose?.();\n",
    to:   "",
  },
  {
    name: "#107 crates in a row again",
    file: F('game.js'),
    from: "        id: `sc${i}`, ..._salvageSpot(b, crates),",
    to:   "        id: `sc${i}`, x: b.x + b.w * (0.15 + 0.7 * (i + 0.5) / n), y: b.y + b.h * 0.5,",
  },
  {
    name: "#107 crates on top of each other",
    file: F('game.js'),
    from: "      if (d >= S.minGap) return p;",
    to:   "      return p;",
  },
  /* (#107 "crates under the log window" dropped: on every hull in the game the
     scatter field ends above that line, so the clamp cannot be seen to bind.) */
  {
    name: "#107 a dose takes three seconds again",
    file: F('ship.js'),
    from: "  static get HEAL_SECONDS() { return 5; }",
    to:   "  static get HEAL_SECONDS() { return 3; }",
  },
  {
    name: "#107 a man walks while taking a dose",
    file: F('crew.js'),
    from: "this._busyAct === 'eat' || this._busyAct === 'heal' || this._busyAct === 'thaw'",
    to:   "this._busyAct === 'eat' || this._busyAct === 'thaw'",
  },
  {
    name: "#107 a thawed captive never breaks out",
    file: F('ship.js'),
    from: "      if (act === 'thaw')   this._breakOut(c);\n",
    to:   "",
  },
  {
    name: "#107 a thawed captive waits to be fetched",
    file: F('ship.js'),
    from: "        this._startBusy(c, 'thaw', null, Ship.THAW_SECONDS);\n",
    to:   "",
  },
  {
    name: "#107 their AI puts a prisoner to work",
    file: F('combat.js'),
    from: "\n                                       && !c.isPrisoner && !c.isPlayer);",
    to:   ");",
  },
  {
    name: "#107 the escapee stays on their deck",
    file: F('game.js'),
    from: "      if (run.length) _boardingParty = _makeParty(",
    to:   "      if (false) _boardingParty = _makeParty(",
  },
  /* ── update108: jj's list from play (part 5: the first contract). ── */
  {
    name: "#108 posters addressed to the Courier Run again",
    file: F('save.js'),
    from: "      ? Object.keys(MISSIONS).filter(k => !MISSIONS[k]?.noWanted) : ['patrol'];",
    to:   "      ? Object.keys(MISSIONS) : ['patrol'];",
  },
  {
    name: "#108 an old Courier poster stays there",
    file: F('save.js'),
    from: "if (w && (!w.mission || !_takesPosters(w.mission))) {",
    to:   "if (w && (!w.mission)) {",
  },
  {
    name: "#108 a \u2620 on the Courier Run map",
    file: F('map.js'),
    from: "    if (mission && typeof MISSIONS !== 'undefined' && MISSIONS[mission]?.noWanted) return;\n",
    to:   "",
  },
  {
    name: "#108 two-gun hulls as common on the Courier Run",
    file: F('game.js'),
    from: "twoBay(layoutKey) && Math.random() >= m.twoGunChance) {",
    to:   "twoBay(layoutKey) && false) {",
  },
  {
    name: "#108 the Courier Run allows every two-gun hull",
    file: F('base.js'),
    from: "    twoGunChance: 0.05,",
    to:   "    twoGunChance: 1,",
  },
  /* ── update109: 1920×1080, part 1 — the foundation. ── */
  {
    name: "#109 the backing is 1280x720 stretched again",
    file: F('renderer.js'),
    from: "    _canvas.width        = Math.max(1, Math.round(cssW * _pixelRatio));",
    to:   "    _canvas.width        = _W;",
  },
  {
    name: "#109 the pixel density is ignored",
    file: F('renderer.js'),
    from: "    _pixelRatio = Math.max(1, window.devicePixelRatio || 1);",
    to:   "    _pixelRatio = 1;",
  },
  {
    name: "#109 the logical screen is 1280x720",
    file: F('renderer.js'),
    from: "  const LOGICAL = Object.freeze({ W: 1920, H: 1080 });",
    to:   "  const LOGICAL = Object.freeze({ W: 1280, H: 720 });",
  },
  {
    name: "#109 no letterbox: the screen overflows the window",
    file: F('renderer.js'),
    from: "    const fit   = Math.min(winW / LOGICAL.W, winH / LOGICAL.H);",
    to:   "    const fit   = Math.max(winW / LOGICAL.W, winH / LOGICAL.H);",
  },
  {
    name: "#109 a frame does not reset the transform",
    file: F('renderer.js'),
    from: "    _applyBase();          // a frame always starts in design units (update109)\n",
    to:   "",
  },
  {
    name: "#109 the design space is drawn unscaled",
    file: F('renderer.js'),
    from: "    _k = _canvas.width / _W;",
    to:   "    _k = 1;",
  },
  {
    name: "#109 the mouse scales by the backing",
    file: F('input.js'),
    from: "    const scaleX = gw / (rect.width  || gw);",
    to:   "    const scaleX = canvas.width / rect.width;",
  },
  /* ── update110: 1920×1080, part 2 — crisp pixel art (the enemy window went in 111). ── */
  {
    name: "#110 crew frames smoothed again",
    file: F('animation.js'),
    from: "        const sm = ctx.imageSmoothingEnabled;\n        ctx.imageSmoothingEnabled = false;\n        /* A crewman",
    to:   "        const sm = ctx.imageSmoothingEnabled;\n        /* A crewman",
  },
  {
    name: "#110 generated sprites smoothed again",
    file: F('assets.js'),
    from: "    ctx.imageSmoothingEnabled = !_isPixelArt(name);",
    to:   "    ctx.imageSmoothingEnabled = true;",
  },
  {
    name: "#110 a crew frame leaves smoothing off",
    file: F('animation.js'),
    from: "        else ctx.drawImage(f, x - w/2, y - h/2, w, h);\n        ctx.imageSmoothingEnabled = sm;",
    to:   "        else ctx.drawImage(f, x - w/2, y - h/2, w, h);",
  },
  /* ── update111: the PRE-FLIGHT BRIEFING — its 9 reverts were retired in
     update113, when the loadout and the destination replaced the briefing. ── */
  /* ── update112: one crew card, one weapon card, one cargo cell. ── */
  {
    name: "#112 the barracks draws its own card again",
    file: F('basescreen.js'),
    from: "      Renderer.drawCrewCard(ctx, c, x, y, 'M', {\n        w: 364, h: 66, on, skills: true,",
    to:   "      (() => 0)(ctx, c, x, y, 'M', {\n        w: 364, h: 66, on, skills: true,",
  },
  {
    name: "#112 the mess berth is not a commander's card",
    file: F('basescreen.js'),
    from: "      w, h, commander: true, reserve: BTN_W + 10,",
    to:   "      w, h, commander: false, reserve: BTN_W + 10,",
  },
  {
    name: "#112 the roster back to a colour square",
    file: F('renderer.js'),
    from: "      drawCrewPortrait(ctx, c, cx + 3, crewY + 3, 20, sel ? '#4db8ff' : null);",
    to:   "      ctx.fillStyle = crewColor(c); ctx.fillRect(cx + 3, crewY + 3, 20, 20);",
  },
  {
    name: "#112 the rack draws its guns its own way again",
    file: F('basescreen.js'),
    from: "      Renderer.drawWeaponCard(ctx, key, px + 560, y, 'M',",
    to:   "      (() => 0)(ctx, key, px + 560, y, 'M',",
  },
  {
    name: "#112 the wound is not on the card",
    file: F('renderer.js'),
    from: "    else if (hp / max <= 0.3) tags.push(['WOUNDED', '#ff2d44']);\n",
    to:   "",
  },
  {
    name: "#112 a grown warehouse no longer scrolls",
    file: F('lootscreen.js'),
    from: "  const VIEW_COLS  = 13;",
    to:   "  const VIEW_COLS  = 99;",
  },
  {
    name: "#112 a click in a scrolled window lands in the first columns",
    file: F('lootscreen.js'),
    from: "    const cx = Math.floor((mx - r.x) / (CELL + GAP)) + r.sx;",
    to:   "    const cx = Math.floor((mx - r.x) / (CELL + GAP));",
  },
  {
    name: "#112 a drop ignores the scroll",
    file: F('lootscreen.js'),
    from: "      const gx = Math.round((mx - CELL / 2 - r.x) / (CELL + GAP)) + r.sx;\n      const gy = Math.round((my - CELL / 2 - r.y) / (CELL + GAP)) + r.sy;\n      if (!Utils.pointInRect(",
    to:   "      const gx = Math.round((mx - CELL / 2 - r.x) / (CELL + GAP));\n      const gy = Math.round((my - CELL / 2 - r.y) / (CELL + GAP)) + r.sy;\n      if (!Utils.pointInRect(",
  },
  {
    name: "#112 scrolling with a crate in hand puts it back",
    file: F('lootscreen.js'),
    from: "act !== 'done' && act !== 'scroll' && !_settle()",
    to:   "act !== 'done' && !_settle()",
  },
  {
    name: "#112 a gun crate shows only its letters",
    file: F('lootscreen.js'),
    from: "    if (gun && Renderer.drawWeaponIcon) {",
    to:   "    if (false) {",
  },
  {
    name: "#112 the loot detail shows no gun card",
    file: F('lootscreen.js'),
    from: "    if (gunIn && Renderer.drawWeaponCard) {\n      Renderer.drawWeaponCard(ctx, it.meta,",
    to:   "    if (false) {\n      Renderer.drawWeaponCard(ctx, it.meta,",
  },
  /* ── update113: the loadout and the destination. ── */
  {
    name: "#113 the bar's LOADOUT button launches straight away",
    file: F('basescreen.js'),
    from: "    _btn(ctx, W - 60 - 220, y + 50, 220, 64, 'LOADOUT  ▶',\n         { act: 'loadout',",
    to:   "    _btn(ctx, W - 60 - 220, y + 50, 220, 64, 'LOADOUT  ▶',\n         { act: 'launch',",
  },
  {
    name: "#113 the loadout draws nothing",
    file: F('basescreen.js'),
    from: "      if (_screen === 'loadout') _drawLoadout(ctx, W, H, b);",
    to:   "      if (_screen === 'loadout') void 0;",
  },
  {
    name: "#113 the base under the loadout stays live",
    file: F('basescreen.js'),
    from: "    if (_screen) {\n      _zones = [];\n",
    to:   "    if (_screen) {\n",
  },
  {
    name: "#113 a crate that fits nowhere falls out of the hand",
    file: F('basescreen.js'),
    from: "      _say('It will not go there — right-click puts it back.', false);\n      return false;",
    to:   "      _hand = null;\n      return false;",
  },
  {
    name: "#113 a crate put down is not saved",
    file: F('basescreen.js'),
    from: "        g.place(it, gx, gy);\n        _hand = null; _sel = it;\n        _commitPack();",
    to:   "        g.place(it, gx, gy);\n        _hand = null; _sel = it;",
  },
  {
    name: "#113 the gun on the mount is not taken off before the swap",
    file: F('basescreen.js'),
    from: "          const off = Base.uninstallWeapon(_shipIdx, m.slot);\n          if (!off.ok) { _say(off.message, false); _hand = null; return false; }",
    to:   "          const off = { ok: true };\n          if (!off.ok) { _say(off.message, false); _hand = null; return false; }",
  },
  {
    name: "#113 a man dropped on a room is not posted",
    file: F('basescreen.js'),
    from: "        _posts[h.id] = room.id;\n",
    to:   "",
  },
  {
    name: "#113 the stage ignores the posts",
    file: F('basescreen.js'),
    from: "      sh.applyPosts?.(_posts);          // the posts chosen in the loadout (update113)\n",
    to:   "",
  },
  {
    name: "#113 the posts do not fly",
    file: F('base.js'),
    from: "      posts: posts ? Object.fromEntries(Object.entries(posts)",
    to:   "      posts: false ? Object.fromEntries(Object.entries(posts)",
  },
  {
    name: "#113 RETURN does not know the posts",
    file: F('game.js'),
    from: "      _savedStations = new Map(_playerShip.crew\n        .filter(c => !c.isPet && loadout.posts[c.id] != null)\n        .map(c => [c.id, loadout.posts[c.id]]));",
    to:   "      void 0;",
  },
  {
    name: "#113 a locked moon still launches",
    file: F('basescreen.js'),
    from: "    const can = open && !!b.ships[_shipIdx] && mission && !S.missionClosed;",
    to:   "    const can = !!b.ships[_shipIdx] && mission && !S.missionClosed;",
  },
  {
    name: "#113 ESCAPE on the destination drops you on the base",
    file: F('basescreen.js'),
    from: "    if (Input.isPressed('Escape')) { _screen = 'loadout'; return null; }",
    to:   "    if (Input.isPressed('Escape')) { _screen = null; return null; }",
  },
  {
    name: "#113 a double-click sends nothing across",
    file: F('basescreen.js'),
    from: "            c.cy >= _hand.homeY && c.cy < _hand.homeY + _hand.item.h) { _loQuickMove(); return null; }",
    to:   "            c.cy >= _hand.homeY && c.cy < _hand.homeY + _hand.item.h) { _loReturn(); return null; }",
  },
  {
    name: "#113 a held drag is only a click",
    file: F('basescreen.js'),
    from: "        Math.hypot(mx - _press.x, my - _press.y) > 8) {",
    to:   "        Math.hypot(mx - _press.x, my - _press.y) > 99999) {",
  },
  {
    name: "#113 a posted room takes more than it holds",
    file: F('ship.js'),
    from: "      const go = movers.slice(0, free);",
    to:   "      const go = movers;",
  },
  /* ── update114: the solar system as it really stands; the Martian moons. ── */
  {
    name: "#114 the planets stand still",
    file: F('basescreen.js'),
    from: "    const L = p.L0 + p.Ld * T;",
    to:   "    const L = p.L0;",
  },
  {
    name: "#114 circular orbits — Kepler skipped",
    file: F('basescreen.js'),
    from: "    for (let i = 0; i < 8; i++) E = M + p.e * Math.sin(E);    // Kepler, by iteration\n",
    to:   "",
  },
  {
    name: "#114 the moons stand still",
    file: F('basescreen.js'),
    from: "      const ang = ((m.L0 + m.rate * days) % 360 + 360) % 360;",
    to:   "      const ang = ((m.L0) % 360 + 360) % 360;",
  },
  {
    name: "#114 a moon is clicked somewhere else than it is drawn",
    file: F('basescreen.js'),
    from: "                .map(m => ({ x: m.sx - 9, y: m.sy - 9, w: 18, h: 18, key: m.key })),",
    to:   "                .map(m => ({ x: m.sx + 40, y: m.sy - 9, w: 18, h: 18, key: m.key })),",
  },
  {
    name: "#114 the distance from Earth is not shown",
    file: F('basescreen.js'),
    from: "      + ` · ${orreryDistance(_destMoon, now)} from Earth today`, '#4db8ff');",
    to:   "      , '#4db8ff');",
  },
  {
    name: "#114 a label lands on another",
    file: F('basescreen.js'),
    from: "        if (placed.some(q => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) continue;\n",
    to:   "",
  },
  {
    name: "#114 a crowded label is left off the map",
    file: F('basescreen.js'),
    from: "      for (const dist of [70, 95, 120]) for (let k = 0; k < 16; k++) {",
    to:   "      for (const dist of []) for (let k = 0; k < 16; k++) {",
  },
  {
    name: "#114 Phobos is not a place",
    file: F('save.js'),
    from: "    phobos:    { key: 'phobos',    label: 'PHOBOS',    body: 'Mars',    locked: true,",
    to:   "    phobos_x:  { key: 'phobos_x',  label: 'PHOBOS',    body: 'Mars',    locked: true,",
  },
  /* ── update115: five tab groups instead of nine tabs. ── */
  {
    name: "#115 a group forgets which screen was open",
    file: F('basescreen.js'),
    from: "        if (g) _tab = _groupLast[g.key] || g.tabs[0][0];",
    to:   "        if (g) _tab = g.tabs[0][0];",
  },
  {
    name: "#115 the sub-tabs are not drawn",
    file: F('basescreen.js'),
    from: "    if (grp.tabs.length > 1) {\n      const SW = 116, SG = 6;",
    to:   "    if (false) {\n      const SW = 116, SG = 6;",
  },
  {
    name: "#115 CREW opens the mess first",
    file: F('basescreen.js'),
    from: "    { key: 'CREW',    tabs: [['CREW', 'BARRACKS'], ['MESS', 'MESS']] },",
    to:   "    { key: 'CREW',    tabs: [['MESS', 'MESS'], ['CREW', 'BARRACKS']] },",
  },
  {
    name: "#115 a screen belongs to no group",
    file: F('basescreen.js'),
    from: "    { key: 'ARCHIVE', tabs: [['MEMORIAL', 'MEMORIAL'], ['WANTED', 'WANTED'], ['GATE', 'GATE']] },",
    to:   "    { key: 'ARCHIVE', tabs: [['MEMORIAL', 'MEMORIAL'], ['WANTED', 'WANTED']] },",
  },
  {
    name: "#115 the pens' sentence runs out of its column",
    file: F('basescreen.js'),
    from: "        : 'no animals yet', tx, penY + 48, px + 360 - tx, 11, 2);",
    to:   "        : 'no animals yet', tx, penY + 48, 9999, 11, 2);",
  },
  {
    name: "#116 the drawn hull is never drawn",
    file: F('ship.js'),
    from: "    const art = this.hullArt();",
    to:   "    const art = null;",
  },
  {
    name: "#116 a hull picture of the wrong size is drawn anyway",
    file: F('ship.js'),
    from: "    if (!img || !g || img.width !== g.box.w || img.height !== g.box.h) return null;\n    return { img, geom: g };",
    to:   "    if (!img || !g) return null;\n    return { img, geom: g };",
  },
  {
    name: "#116 a thumbnail takes a picture of the wrong size",
    file: F('renderer.js'),
    from: "    if (!img || !g || img.width !== g.box.w || img.height !== g.box.h) return null;\n    return { img, box: g.box };",
    to:   "    if (!img || !g) return null;\n    return { img, box: g.box };",
  },
  {
    name: "#116 the thumbnail fits the picture but never draws it",
    file: F('renderer.js'),
    from: "    if (art) ctx.drawImage(art.img, ox, oy, art.box.w * scale, art.box.h * scale);",
    to:   "",
  },
  {
    name: "#116 the code plate is still drawn under the picture",
    file: F('ship.js'),
    from: "    if (art) {\n      ctx.drawImage(art.img, art.geom.box.x, art.geom.box.y);\n    } else {",
    to:   "    if (art) ctx.drawImage(art.img, art.geom.box.x, art.geom.box.y);\n    {",
  },
  {
    name: "#116 the glow sits on the nacelle, not out at the nozzle",
    file: F('ship.js'),
    from: "x: e.exhaustX + (this.isPlayer ? -4 : 4), y: e.y + e.h / 2",
    to:   "x: e.exhaustX + (this.isPlayer ? 14 : -14), y: e.y + e.h / 2",
  },
  {
    name: "#116 an enemy hull borrows your picture",
    file: F('ship.js'),
    from: "    return 'hull_' + layoutKey + (isPlayer ? '' : '_enemy');",
    to:   "    return 'hull_' + layoutKey;",
  },
  {
    name: "#116 a nacelle on a deck that stops short of the stern",
    file: F('ship.js'),
    from: "    [{ d: decks[0], side: 'top' }, { d: decks[decks.length - 1], side: 'bottom' }].forEach(({ d, side }) => {",
    to:   "    decks.map(d => ({ d, side: 'top' })).forEach(({ d, side }) => {",
  },
  {
    name: "#116 three decks at the bow get three noses",
    file: F('ship.js'),
    from: "      if (run && run.y + run.h === d.y) { run.h += d.h; return; }",
    to:   "",
  },
  {
    name: "#116 a station grows engines and a bow",
    file: F('ship.js'),
    from: "  if (!isStation) {\n    const atBow",
    to:   "  if (true) {\n    const atBow",
  },
  {
    name: "#116 the picture box is off the tile grid",
    file: F('ship.js'),
    from: "  PAD_Y:     3 * HULL_GRID.TILE,",
    to:   "  PAD_Y:     3 * HULL_GRID.TILE + 1,",
  },
  {
    name: "#116 the lift trunks are left out of the plate",
    file: F('ship.js'),
    from: "  shaftXs.forEach(cx => plate.push({",
    to:   "  [].forEach(cx => plate.push({",
  },
  {
    name: "#116 a hull picture missing from the manifest",
    file: path.join(ROOT, 'art', 'manifest.json'),
    from: "    \"hull_thoth_enemy\"",
    to:   "    \"hull_thoth_enemy_old\"",
  },
  {
    name: "#117 Phoenix never upgrades the first gun",
    file: F('game.js'),
    from: "    if (traits.gunUpgradeOdds && !_wantedHere && _enemyShip.weapons[0]?.defKey === 'laser_basic'",
    to:   "    if (false && traits.gunUpgradeOdds && !_wantedHere && _enemyShip.weapons[0]?.defKey === 'laser_basic'",
  },
  {
    name: "#117 Phoenix upgrades every first gun",
    file: F('ship.js'),
    from: "gunUpgradeOdds: 0.5,",
    to:   "gunUpgradeOdds: 1.0,",
  },
  {
    name: "#117 Phoenix fits the heavy laser in sector 1",
    file: F('game.js'),
    from: "_enemyShip.installWeapon(sector >= 2 ? traits.gunLate : traits.gunEarly, 0);",
    to:   "_enemyShip.installWeapon(traits.gunLate, 0);",
  },
  {
    name: "#117 Pegasus rolls for her shields like anybody",
    file: F('game.js'),
    from: "      if (traits.shieldsFromSector && sector >= traits.shieldsFromSector) return 'shields';",
    to:   "",
  },
  {
    name: "#117 Pegasus breaks the sector-1 no-shields rule",
    file: F('ship.js'),
    from: "shieldsFromSector: 2,",
    to:   "shieldsFromSector: 1,",
  },
  {
    name: "#117 no second layer on a Pegasus hull",
    file: F('game.js'),
    from: "          sh.level = Math.min(sh.level + 2, SYSTEM_DEFS.shields?.maxLevel ?? 8);",
    to:   "",
  },
  {
    name: "#117 an Aquarius hull drawn without a medbay",
    file: F('ship.js'),
    from: "      { id:'r_medbay',   type:'medbay',   col:1, row:1, adjacent:[] },",
    to:   "      { id:'r_medbay',   type:'empty',    col:1, row:1, adjacent:[] },",
  },
  {
    name: "#117 an Aquarius medbay at level 1",
    file: F('ship.js'),
    from: "medkits: 2, medbayLevel: 2 },",
    to:   "medkits: 2, medbayLevel: 1 },",
  },
  {
    name: "#117 no extra medicine on a hospital ship",
    file: F('game.js'),
    from: "Utils.randInt(2, 4) + (traits.medkits ?? 0);",
    to:   "Utils.randInt(2, 4);",
  },
  {
    name: "#117 Terra builds no spare reactor",
    file: F('game.js'),
    from: "    if (traits.reactorSpare) {\n      const want",
    to:   "    if (false) {\n      const want",
  },
  {
    name: "#117 Terra's drive no hotter",
    file: F('ship.js'),
    from: "reactorSpare: 2, enginesBonus: 1 },",
    to:   "reactorSpare: 2, enginesBonus: 0 },",
  },
  /* (#117) The painter's palette is not reverted here on purpose: the
     game and the tests read the PNGs in art/, not tools/hull_painter.js,
     so breaking the painter changes nothing until somebody re-runs the
     generator. Section 304 reads the pictures' own pixels instead. */
  {
    name: "#117 a hull with no yard",
    file: F('ship.js'),
    from: "    label: 'Isis',\n    builder: 'pegasus',",
    to:   "    label: 'Isis',",
  },
  {
    name: "#117 Hapi built by Phoenix",
    file: F('ship.js'),
    from: "  hauler: buildHull({\n    label: 'Hapi',\n    builder: 'terra',",
    to:   "  hauler: buildHull({\n    label: 'Hapi',\n    builder: 'phoenix',",
  },
  {
    name: "#117 the shipyard card does not name the yard",
    file: F('basescreen.js'),
    from: "      ctx.fillText(CORP_DEFS[yard].label.toUpperCase(), x + w - tw - 10, y + 10 + th + 9);",
    to:   "",
  },
  {
    name: "#117 the hangar preview does not say what the yard is known for",
    file: F('basescreen.js'),
    from: "      ctx.fillText(BUILDER_TRAITS[yard].blurb, cx, py + 51);",
    to:   "",
  },  {
    name: "#118 the roof is never drawn",
    file: F('ship.js'),
    from: "    if (this.roofAlpha > 0) this._drawRoof(ctx, Math.min(1, this.roofAlpha));",
    to:   "",
  },
  {
    name: "#118 the roof is drawn at full strength whatever the fade",
    file: F('ship.js'),
    from: "    ctx.globalAlpha = was * alpha;",
    to:   "    ctx.globalAlpha = was;",
  },
  {
    name: "#118 an enemy hull borrows your roof",
    file: F('ship.js'),
    from: "    const name = HULL_ART.roofName(this.layoutKey, this.isPlayer);",
    to:   "    const name = HULL_ART.roofName(this.layoutKey, true);",
  },
  {
    name: "#118 the roof has the wrong name",
    file: F('ship.js'),
    from: "    return HULL_ART.name(layoutKey, isPlayer) + '_roof';",
    to:   "    return HULL_ART.name(layoutKey, isPlayer) + 'roof';",
  },
  {
    name: "#118 a ship is built closed",
    file: F('ship.js'),
    from: "    this.roofAlpha = 0;\n",
    to:   "    this.roofAlpha = 1;\n",
  },
  {
    name: "#118 no code skin when the roof picture is missing",
    file: F('ship.js'),
    from: "      this.rooms.forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h));\n      (this.elevators",
    to:   "      (this.elevators",
  },
  {
    name: "#118 a card never shows its roof",
    file: F('renderer.js'),
    from: "    const roof = art && (opts.roof ?? 0) > 0 ? shipThumbRoof(",
    to:   "    const roof = false && art && (opts.roof ?? 0) > 0 ? shipThumbRoof(",
  },
  {
    name: "#118 a card takes a roof of any size",
    file: F('renderer.js'),
    from: "    if (!img || img.width !== hull.box.w || img.height !== hull.box.h) return null;\n    return { img, box: hull.box };",
    to:   "    if (!img) return null;\n    return { img, box: hull.box };",
  },
  {
    name: "#118 a card stays closed under the pointer",
    file: F('basescreen.js'),
    from: "    const roof = key ? _roofEase(`row:${key}:${x},${y}`, over ? 0 : 1) : 0;",
    to:   "    const roof = key ? _roofEase(`row:${key}:${x},${y}`, 1) : 0;",
  },
  {
    name: "#118 the hangar hull ignores the pointer",
    file: F('basescreen.js'),
    from: "    sh.roofAlpha = _roofEase('hangar', (onStage || _interior) ? 0 : 1);",
    to:   "    sh.roofAlpha = _roofEase('hangar', _interior ? 0 : 1);",
  },
  {
    name: "#118 [I] does nothing",
    file: F('basescreen.js'),
    from: "    if (!_screen && !modal && _tab === 'HANGAR' && Input.isPressed('KeyI')) return _act('interior');",
    to:   "",
  },
  {
    name: "#118 the loadout shows the hull closed",
    file: F('basescreen.js'),
    from: "      sh.roofAlpha = 0;              // men are posted to rooms here",
    to:   "      sh.roofAlpha = 1;              // men are posted to rooms here",
  },
  {
    name: "#118 the roof snaps instead of fading",
    file: F('basescreen.js'),
    from: "    const k = ROOF_FADE > 0 ? _roofStep / ROOF_FADE : 1;",
    to:   "    const k = 1;",
  },
  {
    name: "#118 the world runs under the film",
    file: F('game.js'),
    from: "      if (_fadeT > 0) _fadeT = Math.max(0, _fadeT - dt);\n      return;\n    }",
    to:   "      if (_fadeT > 0) _fadeT = Math.max(0, _fadeT - dt);\n    }",
  },
  {
    name: "#118 SPACE does not skip the film",
    file: F('game.js'),
    from: "      if (Input.mouse.leftPressed || Input.isPressed('Space') || Input.isPressed('Escape')",
    to:   "      if (Input.mouse.leftPressed || Input.isPressed('Escape')",
  },
  {
    name: "#118 a jump on the map is not filmed",
    file: F('game.js'),
    from: "      // The jump, filmed (update118) \u2014 the outcome below happens at once.\n      if (typeof JumpScene !== 'undefined') JumpScene.jump(_playerShip);",
    to:   "",
  },
  {
    /* update138 turned it round: an escape opens the chart, the jump is filmed on the pick */
    name: "#118 an escape is filmed before he picks where to",
    file: F('game.js'),
    from: "      // the drive is spun: the jump is the node he picks next (update138)\n",
    to:   "      if (typeof JumpScene !== 'undefined') JumpScene.jump(_playerShip);\n",
  },
  {
    name: "#118 a fight opens with no arrival",
    file: F('game.js'),
    from: "the roofs come off for the fight. With the films off: open now. */\n    if (typeof JumpScene !== 'undefined') JumpScene.arrive(_playerShip, _enemyShip);",
    to:   "the roofs come off for the fight. With the films off: open now. */",
  },
  {
    name: "#118 the boss fight opens with no arrival",
    file: F('game.js'),
    from: "      if (typeof JumpScene !== 'undefined') JumpScene.arrive(_playerShip, _enemyShip);   // update118",
    to:   "",
  },
  {
    name: "#118 the fight screen draws the hulls in place, not where the film has them",
    file: F('game.js'),
    from: "    const _drawHull = sh => (typeof JumpScene !== 'undefined') ? JumpScene.drawShip(ctx, sh) : sh.draw(ctx);",
    to:   "    const _drawHull = sh => sh.draw(ctx);",
  },
  {
    name: "#118 the jump film does not cover the fight",
    file: F('game.js'),
    from: "      JumpScene.draw(ctx, Renderer.getWidth(), Renderer.getHeight());\n      return;",
    to:   "      JumpScene.draw(ctx, Renderer.getWidth(), Renderer.getHeight());",
  },
  {
    name: "#118 the arrival does not close the hulls",
    file: F('renderer.js'),
    from: "    if (player) player.roofAlpha = 1;\n    if (enemy)  enemy.roofAlpha  = 1;\n    const enemySlides",
    to:   "    const enemySlides",
  },
  {
    name: "#118 a skipped film leaves the hulls closed",
    file: F('renderer.js'),
    from: "    if (s.kind === 'arrive') {\n      if (s.player) s.player.roofAlpha = 0;",
    to:   "    if (false) {\n      if (s.player) s.player.roofAlpha = 0;",
  },
  {
    name: "#118 the arrival overwrites the jump",
    file: F('renderer.js'),
    from: "    if (cur) queue.push(s); else cur = s;",
    to:   "    cur = s;",
  },
  {
    name: "#118 a bunker drops out of a jump",
    file: F('renderer.js'),
    from: "    return !!ship && !ship.layout?.grounded && !ship.layout?.isStation;",
    to:   "    return !!ship;",
  },
  {
    name: "#118 the fight shows parked hulls under the jump's flash",
    file: F('renderer.js'),
    from: "    const s = cur && cur.kind === 'jump' && queue[0]?.kind === 'arrive' ? { ...queue[0], t: 0 } : cur;",
    to:   "    const s = cur;",
  },
  {
    name: "#118 the real game never plays the films",
    file: F('game.js'),
    from: "    if (typeof JumpScene !== 'undefined') JumpScene.enabled = _filmsOn();",
    to:   "",
    browser: true,
  },
  {
    name: "#119 the module's picture is never drawn",
    file: F('systems.js'),
    from: "    const art = moduleArt(this.type, this.yard ?? null);",
    to:   "    const art = null;",
  },
  {
    name: "#119 a module with no power keeps its lights on",
    file: F('systems.js'),
    from: "      if (!powered) {\n        ctx.fillStyle = MODULE_DARK;",
    to:   "      if (false) {\n        ctx.fillStyle = MODULE_DARK;",
  },
  {
    name: "#119 a module picture of any size is taken",
    file: F('systems.js'),
    from: "    if (!img || img.width !== HULL_GRID.MODULE_W\n        || img.height !== HULL_GRID.MODULE_H - HULL_GRID.VENT_H) continue;",
    to:   "    if (!img) continue;",
  },
  {
    name: "#119 the picture is squashed under a second duct",
    file: F('systems.js'),
    from: "      ctx.drawImage(art, x, y, w, h);\n      if (!powered) {",
    to:   "      ctx.drawImage(art, x, y + HULL_GRID.VENT_H, w, h - HULL_GRID.VENT_H);\n      if (!powered) {",
  },
  {
    name: "#119 an old brig finds no picture",
    file: F('systems.js'),
    from: "'room_' + (SYSTEM_ALIASES[type] ?? type);",
    to:   "'room_' + type;",
  },
  {
    name: "#119 the empty bay looks for the wrong picture",
    file: F('systems.js'),
    from: "  const name = type === 'empty' ? 'room_default' :",
    to:   "  const name = type === 'empty' ? 'room_empty' :",
  },
  {
    name: "#119 an empty bay ignores its picture",
    file: F('ship.js'),
    from: "    const art = typeof moduleArt === 'function' ? moduleArt('empty', hullBuilder(this.layoutKey)) : null;",
    to:   "    const art = null;",
  },
  {
    name: "#119 the old tiles are drawn under the picture",
    file: F('systems.js'),
    from: "    if (art) {\n      ctx.drawImage(art, x, y, w, h);",
    to:   "    if (art) {\n      const t0 = Assets.get('room_default'); if (t0) Assets.tileRect(ctx, t0, x, y, w, h, 48);\n      ctx.drawImage(art, x, y, w, h);",
  },
  {
    name: "#120 the inside ignores the yard",
    file: F('ship.js'),
    from: "    return YARD_TRIM[y] ?? (this.isPlayer ? YARD_TRIM._you : YARD_TRIM._them);",
    to:   "    return this.isPlayer ? YARD_TRIM._you : YARD_TRIM._them;",
  },
  {
    name: "#120 the ducts are blue on every ship",
    file: F('ship.js'),
    from: "    const H = HULL_GRID.VENT_H, T = this.trim(), WALK = 3;",
    to:   "    const H = HULL_GRID.VENT_H, T = YARD_TRIM._you;",
  },
  {
    name: "#120 the duct has no grille",
    file: F('ship.js'),
    from: "        for (let tx = x + 3; tx < x + w - 3; tx += 5) {",   // update128: thinner, in the front layer
    to:   "        for (let tx = x + 3; tx < x + 3; tx += 5) {",
  },
  {
    name: "#120 the lift trunks are not handed the trim",
    file: F('elevator.js'),
    from: "    this._shafts.forEach(s => s.draw(ctx, this.trim ?? null));",
    to:   "    this._shafts.forEach(s => s.draw(ctx));",
  },
  {
    name: "#120 an open door is lit green again",
    file: F('ship.js'),
    from: "    this._drawLamp(ctx);\n  }\n\n  /* ── THE LAMP OVER THE DOOR",
    to:   "    if (o >= 1) { ctx.fillStyle = 'rgba(26,255,140,0.25)'; ctx.fillRect(this.x - w / 2, this.y - half, w, 6); }\n    this._drawLamp(ctx);\n  }\n\n  /* ── THE LAMP OVER THE DOOR",
  },
  {
    name: "#120 door leaves in the old red",
    file: F('ship.js'),
    from: "    const leafCol = trimRgba(S.base, 1);",
    to:   "    const leafCol = '#5a2a2a';",
  },
  {
    name: "#120 the doors are not handed the trim",
    file: F('ship.js'),
    from: "    this.doors.forEach(d => d.draw(ctx, trim));",
    to:   "    this.doors.forEach(d => d.draw(ctx));",
  },
  {
    name: "#120 a frame round every module again",
    file: F('systems.js'),
    from: "    /* NO FRAME ROUND THE MODULE (update120,",
    to:   "    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);\n    /* NO FRAME ROUND THE MODULE (update120,",
  },
  {
    name: "#120 the badge stuck on the painted emblem",
    file: F('systems.js'),
    from: "    if (!art) {\n    ctx.save();\n    const bg = this.badgeRect();",
    to:   "    if (true) {\n    ctx.save();\n    const bg = this.badgeRect();",
  },
  {
    name: "#120 the module ignores its yard's picture",
    file: F('systems.js'),
    from: "    const art = moduleArt(this.type, this.yard ?? null);",
    to:   "    const art = moduleArt(this.type);",
  },
  {
    name: "#120 moduleArt never looks for the yard",
    file: F('systems.js'),
    from: "  for (const n of (yard ? [name + '_' + yard, name] : [name])) {",
    to:   "  for (const n of [name]) {",
  },
  {
    name: "#120 a module does not know its yard",
    file: F('ship.js'),
    from: "    sys.yard   = hullBuilder(this.layoutKey);     // whose colours its picture is in (update120)",
    to:   "",
  },
  {
    name: "#120 the repair does not show in the pip",
    file: F('renderer.js'),
    from: "        if (damaged && p === sys.maxPower - sys.damagedLevels) repairFill(ctx, ix - pipW/2, py, pipW, pipH, sys.repairProgress);",
    to:   "",
  },
  {
    name: "#120 the repair pip fills whole at once",
    file: F('renderer.js'),
    from: "    ctx.fillRect(x, y, w * p, h);",
    to:   "    ctx.fillRect(x, y, w, h);",
  },
  {
    name: "#120 every air lamp always lit",
    file: F('oxygen.js'),
    from: "      ctx.fillStyle = i < lit ? on : 'rgba(4,6,10,0.85)';",
    to:   "      ctx.fillStyle = on;",
  },
  {
    name: "#120 the modules' displays stay blank",
    file: F('ship.js'),
    from: "    this._drawModuleScreens(ctx);\n",
    to:   "",
  },
  {
    name: "#120 the crew walk high again",
    file: F('ship.js'),
    from: "  WALK_FRAC: 0.9, ",
    to:   "  WALK_FRAC: 0.65,",
  },
  {
    name: "#120 the operator stands up on the desk again",
    file: F('ship.js'),
    from: "  static get OPERATOR_LIFT() { return 5; }",
    to:   "  static get OPERATOR_LIFT() { return 14; }",
  },
  {
    name: "#120 the doorways hang over the deck",
    file: F('ship.js'),
    from: "               + HULL_GRID.FEET - DH / 2;",
    to:   "               - DH / 2;",
  },
  {
    name: "#120 the first body in the list, not the nearest",
    file: F('game.js'),
    from: "      if (d < bd) { bd = d; best = c; }",
    to:   "      if (!best) { bd = d; best = c; }",
  },
  {
    name: "#120 no walls between compartments",
    file: F('ship.js'),
    from: "    this._drawBulkheads(ctx);\n",
    to:   "",
  },
  {
    name: "#120 the walls run down into the duct",
    file: F('ship.js'),
    from: "        const top = room.floorTop, h = room.floorH;",
    to:   "        const top = room.y, h = room.h;",
  },
  {
    name: "#120 the duct back on the ceiling",
    file: F('ship.js'),
    from: "  DUCT_BELOW: true, ",
    to:   "  DUCT_BELOW: false,",
  },
  {
    name: "#120 no grates in the walkway",
    file: F('ship.js'),
    from: "      for (let gx = x + 9; gx + 7 <= x + w; gx += 25) {",
    to:   "      for (let gx = x + 9; gx < 0; gx += 25) {",
  },
  {
    name: "#120 the doorway is not cut through the wall",
    file: F('ship.js'),
    // update128: the ship's door (frame, pockets)
    from: "    ctx.fillRect(dx, top, dw, h);\n    // the rail the leaves run in",
    to:   "    // the rail the leaves run in",
  },
  {
    name: "#120 the helm shows the drive's share",
    file: F('ship.js'),
    from: "        return [e.hasPilot ? { t: `EVD +${pct(e.cockpit)}`,",
    to:   "        return [e.hasPilot ? { t: `EVD +${pct(e.engines)}`,",
  },
  {
    name: "#120 the guns always say they will hit",
    file: F('ship.js'),
    from: "    return Utils.clamp(1 - (foe.evasion ?? 0), 0, 1);",
    to:   "    return 1;",
  },
  {
    name: "#120 no GRAV OFF on the drive",
    file: F('ship.js'),
    from: "                  sub: this.zeroG ? 'GRAV OFF' :",
    to:   "                  sub: false ? 'GRAV OFF' :",
  },
  {
    name: "#120 a dark module still writes on its display",
    file: F('ship.js'),
    from: "      if (!powered) return;\n      const lines = this._screenLines(sys, pct);",
    to:   "      const lines = this._screenLines(sys, pct);",
  },
  {
    name: "#120 the reactor's display is blank",
    file: F('ship.js'),
    from: "        return [{ t: `${heatCelsius(heat)}\u00b0`, col }, { t: `${Math.round(heat)}%`, col, bar: heat / 100 }];",
    to:   "        return null;",
  },
  {
    name: "#120 a name over every man again, across the displays",
    file: F('crew.js'),
    from: "    if (this.isPlayer && this.nameShown()) {",
    to:   "    if (this.isPlayer) {",
  },
  {
    name: "#120 a name never shows, even selected",
    file: F('crew.js'),
    from: "      if (typeof UI !== 'undefined' && UI.getSelectedCrewAll?.().includes(this)) return true;",
    to:   "",
  },
  {
    name: "#121 the engines hang off the stern again",
    file: F('ship.js'),
    from: "      const y = side === 'top' ? d.y - M - N.h + 3 : d.y + d.h + M - 3;",
    to:   "      const y = d.y + d.h / 2 - N.h / 2;",
  },
  {
    name: "#121 the nacelles float clear of the plate",
    file: F('ship.js'),
    from: "      const y = side === 'top' ? d.y - M - N.h + 3 : d.y + d.h + M - 3;",
    to:   "      const y = side === 'top' ? d.y - M - N.h - 6 : d.y + d.h + M + 6;",
  },
  {
    name: "#121 the nozzles stick out a whole nacelle",
    file: F('ship.js'),
    from: "      const x = isPlayer ? sternEdge - N.overhang : sternEdge + N.overhang - N.len;",
    to:   "      const x = isPlayer ? sternEdge - N.len : sternEdge;",
  },
  {
    name: "#121 the box keeps the old wide stern",
    file: F('ship.js'),
    from: "  PAD_STERN: HULL_GRID.TILE,                    // 10 — the bell's lip past the plate",   // update128
    to:   "  PAD_STERN: HULL_GRID.ENGINE_W + HULL_GRID.TILE,",
  },
  {
    name: "#121 the box has no room above for the top nacelle",
    file: F('ship.js'),
    from: "  PAD_Y:     3 * HULL_GRID.TILE,                // 30 — a nacelle above, one below",
    to:   "  PAD_Y:     HULL_GRID.TILE,",
  },
  {
    name: "#121 the hulls stand as close as before",
    file: F('ship.js'),
    from: "  static get ENEMY_STATION()  { return { x: 780, y: 200 }; }",
    to:   "  static get ENEMY_STATION()  { return { x: 750, y: 200 }; }",
  },
  {
    name: "#121 the player's nozzles run under the orders panel",
    file: F('ship.js'),
    from: "  static get PLAYER_STATION() { return { x: 145, y: 180 }; }",
    to:   "  static get PLAYER_STATION() { return { x: 115, y: 180 }; }",
  },
  {
    name: "#121 the guns hover above the hull again",
    file: F('ship.js'),
    from: "    const y = Math.round(b.y - HULL_GRID.MARGIN - GH + 2);",
    to:   "    const y = Math.round(b.y - 42);",
  },
  {
    name: "#121 a gun sits on the top nacelle",
    file: F('ship.js'),
    from: "      if (this.isPlayer) lo = Math.max(lo, nac.x + nac.w + 6);",
    to:   "      if (this.isPlayer) lo = lo;",
  },
  {
    name: "#121 a gun has no mount",
    file: F('ship.js'),
    from: "      ctx.closePath(); ctx.fill();\n      ctx.fillStyle = trimRgba(T.light, 0.8);",
    to:   "      ctx.closePath();\n      ctx.fillStyle = trimRgba(T.light, 0.8);",
  },
  {
    name: "#121 the guns on the hull are drawn as shop badges",
    file: F('ship.js'),
    from: "      m.weapon.draw(ctx, m.x, m.y, false, m.dir, { onHull: true });",
    to:   "      m.weapon.draw(ctx, m.x, m.y, false, m.dir);",
  },
  {
    name: "#121 the charge boxes hang under a gun on the hull",
    file: F('weapons.js'),
    from: "    const by   = onHull ? y - 8 : y + h + 3;",
    to:   "    const by   = y + h + 3;",
  },
  {
    name: "#121 the steel housing goes on every gun, the shop's too",
    file: F('renderer.js'),
    from: "    const body = dim ? '#161d2b' : onHull ? '#6c7586' : 'rgba(20,30,50,0.95)';",
    to:   "    const body = dim ? '#161d2b' : '#6c7586';",
  },
  {
    name: "#121 the turret forgets it is on the hull",
    file: F('weapons.js'),
    from: "{ dir, powered: this.powered, type: this.def.type, onHull,\n",
    to:   "{ dir, powered: this.powered, type: this.def.type,\n",
  },
  {
    name: "#122 the reactor's core shows nothing",
    file: F('ship.js'),
    from: "    // …and the reactor's pips on its core (update122).\n    this._drawReactorCore(ctx);\n",
    to:   "    // …and the reactor's pips on its core (update122).\n",
  },
  {
    name: "#122 the pips squeezed into the top of the core",
    file: F('ship.js'),
    from: "    return { x: 45, y: 8, w: 10, h: 36, gap: 1 };",
    to:   "    return { x: 45, y: 8, w: 10, h: 13, gap: 1 };",
  },
  {
    name: "#122 the core fills from the top",
    file: F('ship.js'),
    from: "      pips.push({ x: panel.x + C.gap + c * (pw + C.gap), y: bottom - (r + 1) * (ph + C.gap), w: pw, h: ph });",
    to:   "      pips.push({ x: panel.x + C.gap + c * (pw + C.gap), y: panel.y + C.gap + r * (ph + C.gap), w: pw, h: ph });",
  },
  {
    name: "#122 a big core in one column, every pip a sliver",
    file: F('ship.js'),
    from: "    const cols = n > 8 ? 2 : 1, rows = Math.ceil(n / cols);",
    to:   "    const cols = 1, rows = n;",
  },
  {
    name: "#122 the repair is not shown on the core",
    file: F('ship.js'),
    from: "      if (pip.repairing && typeof Renderer.repairFill === 'function') {",
    to:   "      if (false) {",
  },
  {
    name: "#122 a core drawn on the code tile too",
    file: F('ship.js'),
    from: "    if (!sys || typeof moduleArt !== 'function' || !moduleArt('reactor', sys.yard ?? null)) return;",
    to:   "    if (!sys) return;",
  },
  {
    name: "#122 the bar keeps the pips to itself",
    file: F('renderer.js'),
    from: "moduleIconState, reactorPips, enemyStripBottom,",
    to:   "moduleIconState, enemyStripBottom,",
  },
  {
    name: "#122 an open door's lamp is orange",
    file: F('ship.js'),
    from: "    return this.isAirlock ? 'damaged' : 'open';",
    to:   "    return this.isAirlock ? 'damaged' : 'shut';",
  },
  {
    name: "#122 an open airlock lit green",
    file: F('ship.js'),
    from: "    return this.isAirlock ? 'damaged' : 'open';",
    to:   "    return 'open';",
  },
  {
    name: "#122 a cracked lock is not damage",
    file: F('ship.js'),
    from: "  get damaged() { return !!(this.breached || this.hacked?.player || this.hacked?.enemy); }",
    to:   "  get damaged() { return !!this.breached; }",
  },
  {
    name: "#122 the door lamp as small as before",
    file: F('ship.js'),
    from: "    return { w: 4, h: 3, lift: 8,",
    to:   "    return { w: 2, h: 2, lift: 8,",
  },
  {
    name: "#122 the door lamp on the door's header",
    file: F('ship.js'),
    from: "    return { w: 4, h: 3, lift: 8,",
    to:   "    return { w: 4, h: 3, lift: 2,",
  },
  {
    name: "#122 a lock being worked does not blink",
    file: F('ship.js'),
    from: "    if (st !== 'damaged' && this.hackT > 0 && Math.floor(this.hackT * 4) % 2 === 0) st = 'damaged';\n",
    to:   "",
  },
  {
    name: "#122 an open door has no lamp",
    file: F('ship.js'),
    from: "    this._drawLamp(ctx);\n  }\n\n  /* ── THE LAMP OVER THE DOOR",
    to:   "    if (o < 1) this._drawLamp(ctx);\n  }\n\n  /* ── THE LAMP OVER THE DOOR",
  },
  {
    name: "#122 the airlock has no lamp",
    file: F('ship.js'),
    from: "      this._drawLamp(ctx);\n      return;",
    to:   "      return;",
  },
  {
    name: "#122 the film switch is not saved",
    file: F('game.js'),
    from: "        Save.setSetting?.('jumpFilms', next);\n",
    to:   "",
  },
  {
    name: "#122 the film switch waits for a restart",
    file: F('game.js'),
    from: "        if (typeof JumpScene !== 'undefined') JumpScene.enabled = next;\n",
    to:   "",
  },
  {
    name: "#122 the films off by default",
    file: F('save.js'),
    from: "      jumpFilms:    true,",
    to:   "      jumpFilms:    false,",
  },
  {
    name: "#122 the game ignores the switch at boot",
    file: F('game.js'),
    from: "    if (typeof JumpScene !== 'undefined') JumpScene.enabled = _filmsOn();",
    to:   "    if (typeof JumpScene !== 'undefined') JumpScene.enabled = true;",
  },
  {
    name: "#122 BACK and MUTE left on the film row",
    file: F('game.js'),
    from: "  function _optBackRect() { return { x: 470, y: OPT_BAR.top + 4 * OPT_BAR.gap + 24, w: 150, h: 40 }; }",
    to:   "  function _optBackRect() { return { x: 470, y: OPT_BAR.top + 3 * OPT_BAR.gap + 24, w: 150, h: 40 }; }",
  },
  {
    name: "#122 OPTIONS does not name the switch",
    file: F('game.js'),
    from: "      ctx.fillText('JUMP FILMS', r.x - 20, r.y + 22);\n",
    to:   "",
  },
  {
    name: "#122 ENTER does not skip a film",
    file: F('game.js'),
    from: "          || Input.isPressed('Enter') || Input.isPressed('NumpadEnter')) JumpScene.skip();",
    to:   "          ) JumpScene.skip();",
  },
  {
    name: "#122 the hint still says SPACE",
    file: F('renderer.js'),
    from: "  const SKIP_HINT = 'ENTER — skip';",
    to:   "  const SKIP_HINT = 'click or SPACE to skip';",
  },
  {
    name: "#122 the arrival does not say it can be skipped",
    file: F('renderer.js'),
    from: "    ctx.fillText(SKIP_HINT, W / 2, H - 28);\n    if (cur.player) {",
    to:   "    if (cur.player) {",
  },
  {
    name: "#123 the title screen has no NEW GAME",
    file: F('game.js'),
    from: "const MENU_ITEMS = ['ENTER BASE','OPTIONS','NEW GAME'];",
    to:   "const MENU_ITEMS = ['ENTER BASE','OPTIONS'];",
  },
  {
    name: "#123 NEW GAME wipes without asking",
    file: F('game.js'),
    from: "        if (_menuHover === 2) { _menuConfirm = true; _menuConfirmHover = null; }",
    to:   "        if (_menuHover === 2) { _newGame(); }",
  },
  {
    name: "#123 the question lets clicks through to the buttons",
    file: F('game.js'),
    from: "    if (_menuConfirm) { _updateMenuConfirm(); return; }",
    to:   "    if (_menuConfirm) _updateMenuConfirm();",
  },
  {
    name: "#123 ESC does not close the question",
    file: F('game.js'),
    from: "    if (Input.isPressed('Escape')) { _menuConfirm = false; return; }\n",
    to:   "",
  },
  {
    name: "#123 a click anywhere wipes the save",
    file: F('game.js'),
    from: "    if (_menuConfirmHover === 'keep' || !_menuConfirmHover) {",
    to:   "    if (_menuConfirmHover === 'keep') {",
  },
  {
    name: "#123 WIPE AND START wipes nothing",
    file: F('game.js'),
    from: "    Save.reset();\n    _menuConfirm = false;",
    to:   "    _menuConfirm = false;",
  },
  {
    name: "#123 no line under ENTER BASE",
    file: F('game.js'),
    from: "      if (i === 0) {\n        const st = _menuStatus();",
    to:   "      if (false) {\n        const st = _menuStatus();",
  },
  {
    name: "#123 a blank run record reads as a contract",
    file: F('game.js'),
    from: "    if (run?.shipKey) {\n      const m =",
    to:   "    if (run) {\n      const m =",
  },
  {
    name: "#123 the buttons back at 56 px, no room for the line",
    file: F('game.js'),
    from: "const MENU_LAYOUT = { top: -20, gap: 70,",
    to:   "const MENU_LAYOUT = { top: -20, gap: 56,",
  },
  {
    name: "#123 the flyby across the buttons",
    file: F('game.js'),
    from: "flyY: 0.87, flyScale: 0.6 };",
    to:   "flyY: 0.62, flyScale: 0.6 };",
  },
  {
    name: "#123 the flyby at full size",
    file: F('game.js'),
    from: "flyY: 0.87, flyScale: 0.6 };",
    to:   "flyY: 0.87, flyScale: 1 };",
  },
  {
    name: "#123 the hull stands still",
    file: F('game.js'),
    from: "    const x = -w - behind - 120 + span * k;",
    to:   "    const x = W / 2;",
  },
  {
    name: "#123 the title screen draws no hull",
    file: F('game.js'),
    from: "    // your hull, going past the Moon — under everything else\n    _drawMenuShip(ctx, Date.now() / 1000);\n",
    to:   "    // your hull, going past the Moon — under everything else\n",
  },
  {
    name: "#123 a new hull every frame",
    file: F('game.js'),
    // Re-aimed in update131: the cache asks the record too.
    from: "    if (!_menuShip || _menuShipKey !== src.key || _menuShipSrc !== src.data) {",
    to:   "    if (true) {",
  },
  {
    name: "#123 the flyby with its roof off",
    file: F('game.js'),
    from: "      if (_menuShip) _menuShip.roofAlpha = 1;",
    to:   "      if (_menuShip) _menuShip.roofAlpha = 0;",
  },
  {
    name: "#123 the scout flies past whatever you own",
    file: F('game.js'),
    from: "    if (run?.shipKey && SHIP_LAYOUTS[run.shipKey]) return run.shipKey;",
    to:   "    if (false) return run.shipKey;",
  },
  {
    name: "#123 the title screen throws before a save is read",
    file: F('game.js'),
    from: "  function _menuRun() { try { return Save.getRun?.() ?? null; } catch (e) { return null; } }",
    to:   "  function _menuRun() { return Save.getRun?.() ?? null; }",
  },
  {
    name: "#124 at a console he faces the room",
    file: F('crewart.js'),
    from: "    operate: { view: 'back',",
    to:   "    operate: { view: 'side',",
  },
  {
    name: "#124 standing about, side on",
    file: F('crewart.js'),
    from: "    idle:    { view: 'front',",
    to:   "    idle:    { view: 'side', ",
  },
  {
    name: "#124 eating, side on",
    file: F('crewart.js'),
    from: "    eat:     { view: 'front',",
    to:   "    eat:     { view: 'side', ",
  },
  {
    name: "#124 the side view carries a fat pack",
    file: F('crewart.js'),
    from: "    px(g, ox + 4, y0 + 12, 2, 8, TANK); px(g, ox + 6, y0 + 12, 1, 8, TANKD);",
    to:   "    px(g, ox + 2, y0 + 12, 6, 9, TANK);",
  },
  {
    name: "#124 one bottle on his back",
    file: F('crewart.js'),
    from: "    px(g, ox + 6, y0 + 11, 3, 8, TANK); px(g, ox + 11, y0 + 11, 3, 8, TANK);",
    to:   "    px(g, ox + 6, y0 + 11, 3, 8, TANK);",
  },
  {
    name: "#124 every eye one colour",
    file: F('crewart.js'),
    from: "      eyes2: hash(seed, 12) < 0.06 ?",
    to:   "      eyes2: hash(seed, 12) < 0 ?",
  },
  {
    name: "#124 nobody wears glasses",
    file: F('crewart.js'),
    from: "  const GLASSES = ['none', 'none', 'none', 'none', 'round', 'square', 'shades', 'goggles'];",
    to:   "  const GLASSES = ['none'];",
  },
  {
    name: "#124 everybody's eyes are brown",
    file: F('crewart.js'),
    from: "  const EYE_ROLL = ['brown', 'brown', 'brown', 'dark', 'dark', 'hazel', 'amber', 'green', 'green',\n                    'blue', 'blue', 'blue', 'ice', 'grey', 'grey', 'violet'];",
    to:   "  const EYE_ROLL = ['brown'];",
  },
  {
    name: "#124 one hair colour for everybody",
    file: F('crewart.js'),
    from: "      skin: pick(SKIN, seed, 1), hair: pick(HAIR, seed, 2),",
    to:   "      skin: pick(SKIN, seed, 1), hair: HAIR[0],",
  },
  {
    name: "#124 Terra without the implant",
    file: F('crewart.js'),
    from: "      cyborg: race === 'terra',",
    to:   "      cyborg: false,",
  },
  {
    name: "#124 the frames painted every time",
    file: F('crewart.js'),
    from: "    if (_frames.has(key)) return _frames.get(key);\n",
    to:   "",
  },
  {
    name: "#124 the new frames squeezed into the old 32",
    file: F('crewart.js'),
    from: "    a.native = { w: FRAME.w, h: FRAME.h, ax: FRAME.ax, ay: FRAME.ay };\n",
    to:   "",
  },
  {
    name: "#124 the portrait painted every time",
    file: F('crewart.js'),
    from: "    if (_portraits.has(key)) return _portraits.get(key);\n",
    to:   "",
  },
  {
    name: "#124 the saved face is ignored",
    file: F('crewart.js'),
    from: "    if (Number.isFinite(rec?.faceSeed)) return rec.faceSeed | 0;\n",
    to:   "",
  },
  {
    name: "#124 the face is not saved",
    file: F('crew.js'),
    from: "      joined: this.joined, faceSeed: this.faceSeed,",
    to:   "      joined: this.joined,",
  },
  {
    name: "#124 a new man gets his name's face",
    file: F('crew.js'),
    from: "                  : CrewArt.newSeed();                          // a new face",
    to:   "                  : CrewArt.seedOf(cfg);",
  },
  {
    name: "#124 an old record gets a new face every load",
    file: F('crew.js'),
    from: "                  : cfg.id != null ? CrewArt.seedOf(cfg)       // a saved man from before 124",
    to:   "                  : cfg.id != null ? CrewArt.newSeed()",
  },
  {
    name: "#124 nobody is seen eating",
    file: F('crew.js'),
    from: "    const key = (state === 'idle' && this._meal && !this.isPet) ? 'eat'\n",   // update128: heal joined it
    to:   "    const key = false ? 'eat'\n",
  },
  {
    name: "#124 a meal begun on the spot is not shown",
    file: F('crew.js'),
    from: "    if (this._animState === 'idle' && ((this._animKey === 'eat') !== !!(this._meal && !this.isPet))) {\n      this._setAnim('idle');\n    }\n",
    to:   "",
  },
  {
    name: "#124 the old frames come back",
    file: F('crew.js'),
    from: "    this.anim = (typeof CrewArt !== 'undefined')\n      ? CrewArt.anim(key, this)",
    to:   "    this.anim = (false)\n      ? CrewArt.anim(key, this)",
  },
  {
    name: "#124 the health boxes stay on his helmet",
    file: F('crew.js'),
    from: "    const LIFT = this.anim?.native ? CrewMember.LIFT : 0;",
    to:   "    const LIFT = 0;",
  },
  {
    name: "#124 a body is the standing man turned over",
    file: F('crew.js'),
    from: "      if (this.anim?.native && typeof CrewArt !== 'undefined') {",
    to:   "      if (false) {",
  },
  {
    name: "#124 the red ring a small circle round his middle",
    file: F('crew.js'),
    from: "    if (!this.isPet && this.anim?.native) ctx.ellipse(",
    to:   "    if (false) ctx.ellipse(",
  },
  {
    name: "#124 the click box the old man's",
    file: F('crew.js'),
    from: "  static get HIT() { return { cy: -9, rx: 9, ry: 15 }; }",
    to:   "  static get HIT() { return { cy: -1, rx: 8, ry: 14 }; }",
  },
  {
    name: "#124 a body's click box stands up",
    file: F('crew.js'),
    from: "  static get HIT_LYING() { return { cy: 2, rx: 13, ry: 9 }; }",
    to:   "  static get HIT_LYING() { return { cy: -1, rx: 8, ry: 14 }; }",
  },
  {
    name: "#124 the click ignores the taller man",
    file: F('game.js'),
    from: "      ? ((c.dead || c.down) ? CrewMember.HIT_LYING : CrewMember.HIT)   // a body lies flat (update124)",
    to:   "      ? { cy: -1, rx: 8, ry: 14 }",
  },
  {
    name: "#124 a stale index.html has no crew art",
    file: F('game.js'),
    from: "    { name: 'CrewArt',      src: 'js/crewart.js' },\n",
    to:   "",
  },
  {
    name: "#124 the cards keep the sprite",
    file: F('renderer.js'),
    from: "    const face = (typeof CrewArt !== 'undefined' && CrewArt.isPerson(rec)) ? CrewArt.portraitCanvas(rec) : null;",
    to:   "    const face = null;",
  },
  {
    name: "#124 the 20 px list shrinks the whole portrait",
    file: F('renderer.js'),
    from: "        if (s < 32) ctx.drawImage(face, 9, 6, 30, 30, x, y, s, s);",
    to:   "        if (false) ctx.drawImage(face, 9, 6, 30, 30, x, y, s, s);",
  },
  {
    name: "#124 the frame's own size ignored",
    file: F('animation.js'),
    from: "        if (n) ctx.drawImage(f, Math.round(x - n.ax), Math.round(y - n.ay), n.w, n.h);",
    to:   "        if (false) ctx.drawImage(f, Math.round(x - n.ax), Math.round(y - n.ay), n.w, n.h);",
  },
  {
    name: "#124 a commander gets a new face",
    file: F('commander.js'),
    from: "      faceSeed: (typeof CrewArt !== 'undefined') ? CrewArt.seedOf(rec) : rec.faceSeed,\n",
    to:   "",
  },
  {
    name: "#124 crewart.js never published",
    file: F('crewart.js'),
    from: "if (typeof window !== 'undefined') window.CrewArt = CrewArt;",
    to:   "",
  },
  {
    name: "#125 the raider is not drawn",
    file: F('game.js'),
    from: "    if (foe && f.foe) _drawHullAt(ctx, foe, f.foe);\n",
    to:   "",
  },
  {
    name: "#125 the chaser flies ahead of you",
    file: F('game.js'),
    from: "    if (fb) out.foe = { x: x - C.gap - fw,",
    to:   "    if (fb) out.foe = { x: x + w + C.gap,",
  },
  {
    name: "#125 nobody fires",
    file: F('game.js'),
    // Re-aimed in update131: the chase is a real exchange of Projectiles.
    from: "      S.shots.push(p); S.fired++;",
    to:   "      void p;",
  },
  {
    name: "#125 you never fire back",
    file: F('game.js'),
    // Re-aimed in update131: your side of the exchange.
    from: "      { me: you, them: foe, mine: 'you', theirs: 'foe' },\n",
    to:   "",
  },
  {
    name: "#125 shots out of empty space",
    file: F('game.js'),
    // Re-aimed in update131: whether both hulls are on the screen.
    from: "    return foeR.x + foeR.w > 20 && youR.x < W - 20;",
    to:   "    return true;",
  },
  {
    name: "#125 the dots sit on the bars",
    file: F('renderer.js'),
    from: "      const cy = bars ? (isStar ? 2.5 : 2.4) : 5;",
    to:   "      const cy = 5;",
  },
  {
    name: "#125 five dots in a row",
    file: F('renderer.js'),
    from: "    return { marks: (n % 4) + 1, bars: Math.floor(n / 4), star };",
    to:   "    return { marks: (n % 5) + 1, bars: Math.floor(n / 5), star };",
  },
  {
    name: "#125 the Recruit gets a mark",
    file: F('renderer.js'),
    from: "    if (l === 0) return null;\n",
    to:   "",
  },
  {
    name: "#125 the bars fall out of the box",
    file: F('renderer.js'),
    from: "      const BAR_H = 1.1, BAR_GAP = 0.7, BAR_TOP = 5.2;",
    to:   "      const BAR_H = 1.1, BAR_GAP = 0.7, BAR_TOP = 7.5;",
  },
  {
    name: "#125 the cheapest hull gives chase",
    file: F('game.js'),
    from: "      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));",
    to:   "      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0));",
  },
  {
    name: "#125 you are chased by yourself",
    file: F('game.js'),
    from: "      .filter(d => d && SHIP_LAYOUTS[d.key] && d.key !== mine)",
    to:   "      .filter(d => d && SHIP_LAYOUTS[d.key])",
  },
  {
    name: "#125 the chaser shrunk",
    file: F('game.js'),
    from: "const MENU_CHASE = { foeScale: 0.6,",
    to:   "const MENU_CHASE = { foeScale: 0.45,",
  },
  {
    name: "#125 the chaser flies backwards",
    file: F('game.js'),
    // Re-aimed in update131 (the raider is fitted and manned after this line).
    from: "        _menuFoe = new Ship(key, true, 0, 0); _menuFoe.roofAlpha = 1; _menuFoeKey = key;",
    to:   "        _menuFoe = new Ship(key, false, 0, 0); _menuFoe.roofAlpha = 1; _menuFoeKey = key;",
  },
  {
    name: "#125 the chaser built every frame",
    file: F('game.js'),
    from: "    if (!_menuFoe || _menuFoeKey !== key) {",
    to:   "    if (true) {",
  },
  {
    name: "#126 every gun the same machine",
    file: F('weaponart.js'),
    from: "    switch (st.form) {",
    to:   "    switch ('rail') {",
  },
  {
    name: "#126 a charged gun looks cold",
    file: F('weaponart.js'),
    from: "      if (charge > 0.5 && lit) R(ctx, lx + Math.floor(lw / 2), ly + Math.floor(lh / 2), 1, 1, '#ffffff');\n",
    to:   "",
  },
  {
    name: "#126 an unpowered gun lit up",
    file: F('weaponart.js'),
    from: "    if (!lit) {                       // dark and dull when off, as before",
    to:   "    if (false) {",
  },
  {
    name: "#126 the barrel never kicks",
    file: F('weaponart.js'),
    from: "    ctx.translate(-kick, 0);",
    to:   "    ctx.translate(0, 0);",
  },
  {
    name: "#126 a card in steel",
    file: F('weaponart.js'),
    from: "    const P = opts.card ? CARD : STEEL;",
    to:   "    const P = STEEL;",
  },
  {
    name: "#126 painted with dice",
    file: F('weaponart.js'),
    from: "    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;",
    to:   "    return Math.random();",
  },
  {
    name: "#126 an effect never ends",
    file: F('weaponart.js'),
    from: "      if (_clock - _fx[i].born >= LIFE[_fx[i].kind]) _fx.splice(i, 1);\n",
    to:   "",
  },
  {
    name: "#126 no cap on effects",
    file: F('weaponart.js'),
    from: "    if (_fx.length > MAX_FX) _fx.splice(0, _fx.length - MAX_FX);\n",
    to:   "",
  },
  {
    name: "#126 the scorch over the shots",
    file: F('weaponart.js'),
    from: "      if ((fx.kind === 'scorch') !== (layer === 'under')) continue;",
    to:   "      if (layer === 'under') continue;",
  },
  {
    name: "#126 any effect taken",
    file: F('weaponart.js'),
    from: "    if (!fx || !LIFE[fx.kind]) return null;",
    to:   "    if (!fx) return null;",
  },
  {
    name: "#126 a heavy laser's bolt is a plain one",
    file: F('weaponart.js'),
    from: "    if (defKey === 'laser_heavy' || type === 'laser_heavy') return 'heavy';\n",
    to:   "",
  },
  {
    name: "#126 every hit the laser's",
    file: F('weaponart.js'),
    from: "    return HIT_OF[shotKind(type, defKey)] || 'laser';",
    to:   "    return 'laser';",
  },
  {
    name: "#126 the old badges back",
    file: F('renderer.js'),
    from: "    if (typeof WeaponArt !== 'undefined') {\n      WeaponArt.turret(",
    to:   "    if (false) {\n      WeaponArt.turret(",
  },
  {
    name: "#126 the card asks for steel",
    file: F('renderer.js'),
    from: "{ ...opts, type, card: !opts.onHull }",
    to:   "{ ...opts, type, card: false }",
  },
  {
    name: "#126 the gun does not kick",
    file: F('weapons.js'),
    from: "    this.kick();\n    if (projs[0]",
    to:   "    if (projs[0]",
  },
  {
    name: "#126 no flash at the barrel",
    file: F('weapons.js'),
    from: "    if (projs[0] && !(projs[0].launchDelay > 0)) Projectile.flash(projs[0]);\n",
    to:   "",
  },
  {
    name: "#126 the barrel never runs out",
    file: F('weapons.js'),
    from: "    this.recoil = Math.max(0, (this.recoil ?? 0) - dt * Weapon.RECOIL_RETURN);\n",
    to:   "",
  },
  {
    name: "#126 the painter is not told",
    file: F('weapons.js'),
    from: "                                charge: this.charge, armed: this.armed, recoil: this.recoil ?? 0,\n",
    to:   "",
  },
  {
    name: "#126 the second bolt is quiet",
    file: F('weapons.js'),
    from: "        Projectile.flash(this);\n        this.gun?.kick?.();\n",
    to:   "",
  },
  {
    name: "#126 the shot forgets its gun",
    file: F('weapons.js'),
    from: "        defKey: this.defKey, gun: this,\n",
    to:   "",
  },
  {
    name: "#126 the shot drawn the old way",
    file: F('weapons.js'),
    from: "    if (this.type !== 'asteroid' && this.type !== 'beam' && typeof WeaponArt !== 'undefined') {",
    to:   "    if (false) {",
  },
  {
    name: "#126 a miss stops at the room",
    file: F('weapons.js'),
    from: "    if (this.flyOn) {\n",
    to:   "    if (false) {\n",
  },
  {
    name: "#126 a miss flies on forever",
    file: F('weapons.js'),
    from: "      if (this.x < -80 || this.x > W + 80 || this.y < -80 || this.y > H + 80\n          || this.flyT > Projectile.FLY_ON_MAX) this.done = true;\n",
    to:   "",
  },
  {
    name: "#126 the beam leaves no scar",
    file: F('weapons.js'),
    from: "      WeaponArt.beamScar(ctx, shipX, cutY, cutX, 1);\n",
    to:   "",
  },
  {
    name: "#126 the bubble shows nothing",
    file: F('ship.js'),
    from: "      Ship._fx({ kind: 'shield', x: proj.x, y: proj.y, shield: this.shieldEllipse() });\n",
    to:   "",
  },
  {
    name: "#126 armour silent",
    file: F('ship.js'),
    from: "        Ship._fx({ kind: 'armour', x: proj.x, y: proj.y });\n",
    to:   "",
  },
  {
    name: "#126 no scorch",
    file: F('ship.js'),
    from: "      if (dmg > 0 || modDmg > 0) Ship._fx({ kind: 'scorch', x: proj.x, y: proj.y });\n",
    to:   "",
  },
  {
    name: "#126 a scorch from everything",
    file: F('ship.js'),
    from: "      if (dmg > 0 || modDmg > 0) Ship._fx({ kind: 'scorch'",
    to:   "      if (true) Ship._fx({ kind: 'scorch'",
  },
  {
    name: "#126 one shake for all",
    file: F('ship.js'),
    from: "    Camera.shake(Ship.HIT_SHAKE[kind] ?? 6, 0.2);",
    to:   "    Camera.shake(6, 0.2);",
  },
  {
    name: "#126 the old puff for every hit",
    file: F('ship.js'),
    from: "    const kind = (typeof WeaponArt !== 'undefined') ? WeaponArt.hitKind(proj.type, proj.defKey) : null;",
    to:   "    const kind = null;",
  },
  {
    name: "#126 the bubble is drawn smaller than it stops",
    file: F('ship.js'),
    from: "    return dx * dx + dy * dy <= 1;",
    to:   "    return dx * dx + dy * dy <= 0.25;",
  },
  {
    name: "#126 a miss leaves no ring",
    file: F('ship.js'),
    from: "      Ship._fx({ kind: 'miss', x: proj.x, y: proj.y });\n",
    to:   "",
  },
  {
    name: "#126 the bubble lets it in",
    file: F('combat.js'),
    from: "      if (ship.insideShield(p.x, p.y)) { p.hit = true; p.done = true; p.atShield = true; }\n",
    to:   "",
  },
  {
    name: "#126 a shield stops a missile",
    file: F('combat.js'),
    from: "      if (Ship.piercesShields(p.def ?? {})) return;\n",
    to:   "",
  },
  {
    name: "#126 a dodged shot vanishes",
    file: F('combat.js'),
    from: "      if (result.dodged) Combat._flyOn(p);",
    to:   "      if (false) Combat._flyOn(p);",
  },
  {
    name: "#126 scorches over the shots",
    file: F('combat.js'),
    from: "    if (typeof WeaponArt !== 'undefined') WeaponArt.draw(ctx, 'under');\n",
    to:   "",
  },
  {
    name: "#126 the last fight's scorch",
    file: F('combat.js'),
    from: "    if (typeof WeaponArt !== 'undefined') WeaponArt.clear();   // no scorch from the last fight\n",
    to:   "",
  },
  {
    name: "#126 the effects' clock stopped",
    file: F('game.js'),
    from: "    if (typeof WeaponArt !== 'undefined') WeaponArt.update(dt);   // the blasts play out (update126)\n",
    to:   "",
  },
  {
    name: "#126 not in the late loader",
    file: F('game.js'),
    from: "    { name: 'WeaponArt',    src: 'js/weaponart.js' },\n",
    to:   "",
  },  {
    name: "#127 a slab pops at once",
    file: F('ship.js'),
    from: "      if (c._meltT >= Ship.SLAB_MELT_SECONDS) done.push(c);",
    to:   "      done.push(c);",
  },
  {
    name: "#127 power back does not stop the melt",
    file: F('ship.js'),
    from: "      if (!melting.has(c)) { c._meltT = 0; c._meltWarned = false; return; }",
    to:   "      if (!melting.has(c)) return;",
  },
  {
    name: "#127 the melt warning every frame",
    file: F('ship.js'),
    from: "      if (!c._meltWarned) {\n        c._meltWarned = true;",
    to:   "      if (true) {\n        c._meltWarned = true;",
  },
  {
    name: "#127 a thaw keeps the melt",
    file: F('ship.js'),
    from: "    c._meltT = 0; c._meltWarned = false;\n    const pod  = this.getSystem('carbonite');",
    to:   "    const pod  = this.getSystem('carbonite');",
  },
  {
    name: "#127 the melt not drawn",
    file: F('crew.js'),
    from: "      if (melt > 0) {\n        ctx.fillStyle = 'rgba(7,8,15,0.55)';",
    to:   "      if (false) {\n        ctx.fillStyle = 'rgba(7,8,15,0.55)';",
  },
  {
    name: "#127 their power AI not wired",
    file: F('combat.js'),
    from: "    enemy.rePowerAI?.(dt);\n",
    to:   "",
  },
  {
    name: "#127 re-power fights the cooling AI",
    file: F('ship.js'),
    from: "    if (this._aiShed?.length) return;                          // the cooling AI has the bar\n",
    to:   "",
  },
  {
    name: "#127 a dark gun borrows nothing",
    file: F('ship.js'),
    from: "        d.desiredPower -= 1; g.desiredPower = 1;",
    to:   "        return;",
  },
  {
    name: "#127 their flow cuts the gun first",
    file: F('ship.js'),
    from: "      : ((rank(b) - rank(a)) || (b - a)));",
    to:   "      : (b - a));",
  },
  {
    name: "#127 no post ever leaves to repair",
    file: F('combat.js'),
    from: "        if (!spare && !fixing) pool = idle.slice();\n",
    to:   "",
  },

  {
    name: "#127 he stays in the room he fixed",
    file: F('combat.js'),
    from: "      if (home && c.roomId !== home.id) c.moveToOnShip(enemy, ...enemy.stationSpot(home, null, c));\n",
    to:   "",
  },
  {
    name: "#127 the last man never runs",
    file: F('combat.js'),
    from: "      if (left.length === 1 && !away) {",
    to:   "      if (false) {",
  },
  {
    name: "#127 he runs and leaves his boarder",
    file: F('combat.js'),
    from: "      if (left.length === 1 && !away) {",
    to:   "      if (left.length === 1) {",
  },
  {
    name: "#127 they jump with nobody at the helm",
    file: F('combat.js'),
    from: "      } else if (!helm) {",
    to:   "      } else if (false) {",
  },
  {
    name: "#127 the suit flies home backwards",
    file: F('game.js'),
    from: "      if (Math.abs(dx) > 1 && m.c) m.c._facing = dx > 0 ? 1 : -1;\n",
    to:   "",
  },
  {
    name: "#127 a recall flies backwards",
    file: F('game.js'),
    from: "        if (Math.abs(dx) > 1) c._facing = dx > 0 ? 1 : -1;   // update127: a recall flies home facing home\n",
    to:   "",
  },
  {
    name: "#127 the port opens over the film",
    file: F('game.js'),
    from: "      if (typeof JumpScene !== 'undefined' && JumpScene.active()) _stationOpenPending = true;\n      else UI.openStation(_station, _playerShip);",
    to:   "      UI.openStation(_station, _playerShip);",
  },
  {
    name: "#127 the escape bar says where to shoot",
    file: F('game.js'),
    from: "'hit HELM / ENGINES'",
    to:   "'ENGINES'",
  },
  {
    name: "#127 the helm and engines not framed",
    file: F('game.js'),
    from: "        ['piloting', 'engines'].forEach(type => {",
    to:   "        [].forEach(type => {",
  },
  {
    name: "#127 the cloak label back",
    file: F('ship.js'),
    from: "         left are on the cloak's own pip in the power panel. */\n    }",
    to:   "         left are on the cloak's own pip in the power panel. */\n      ctx.fillText('CLOAKED 5s', 0, 0);\n    }",
  },
  {
    name: "#127 their core lights every unit",
    file: F('renderer.js'),
    from: "      for (let p = 0; p < (reactorCol ? 0 : sys.maxPower); p++) {",
    to:   "      for (let p = 0; p < sys.maxPower; p++) {",
  },
  {
    name: "#127b the loadout picture freezes mid-walk",
    file: F('basescreen.js'),
    from: "          if (i >= 10 && settled()) break;",
    to:   "          if (i >= 29) break;",
  },
  {
    name: "#127 their core's icon grey",
    file: F('renderer.js'),
    from: "    if (sys.type === 'reactor') return sys._offline ? 'off' : 'running';\n",
    to:   "",
  },
  {
    name: "#128 a ring round hostiles again",
    file: F('crew.js'),
    from: "    /* \u2026RETIRED in update128 (jj: \"otoczki czerwone na za\u0142ogantach wroga",
    to:   "    if (!this.isPlayer && !this.down) this.drawSideRing(ctx);\n    /* \u2026RETIRED in update128 (jj: \"otoczki czerwone na za\u0142ogantach wroga",
  },
  {
    name: "#128 health boxes not framed",
    file: F('renderer.js'),
    from: "      if (edge) {\n        ctx.strokeStyle = edge;",
    to:   "      if (false) {\n        ctx.strokeStyle = edge;",
  },
  /* (#128 keys at the hands: painted into art/ — the game reads the PNG, section 315 reads its pixels.) */

  {
    name: "#128 the frozen stay where they stood",
    file: F('ship.js'),
    from: "    this._placeSlabs();                  // into a window of the bay (update128)\n",
    to:   "",
  },
  {
    name: "#128 slabs not kept",
    file: F('ship.js'),
    from: "    this._placeSlabs();                  // the frozen stay in their windows (update128)\n",
    to:   "",
  },
  {
    name: "#128 two men in one slab",
    file: F('ship.js'),
    from: "        if (c._slabIdx == null) { c._slabIdx = [0, 1, 2].find(i => !taken.has(i)) ?? 0; taken.add(c._slabIdx); }",
    to:   "        if (c._slabIdx == null) { c._slabIdx = 0; }",
  },
  {
    name: "#128 slab not saved",
    file: F('crew.js'),
    from: "_slabRoom: this._slabRoom, _slabIdx: this._slabIdx,",
    to:   "_slabRoom: this._slabRoom,",
  },
  {
    name: "#128 a thawed man keeps his slab",
    file: F('ship.js'),
    from: "    c._slabIdx = null; c._slab = null;\n",
    to:   "",
  },
  {
    name: "#128 every slab says its name",
    file: F('crew.js'),
    from: "          !Utils.pointInRect(Input.mouse.x, Input.mouse.y, slab.x, slab.y, slab.w, slab.h)) return;",
    to:   "          false) return;",
  },
  {
    name: "#128 the door has no frame",
    file: F('ship.js'),
    from: "    ctx.fillRect(fx, top - F.header, F.w, F.header);",
    to:   "    ctx.fillRect(fx, top, 0, 0);",
  },
  {
    name: "#128 an open door shows no leaves",
    file: F('ship.js'),
    from: "    const lf = Math.max(stub, leaf);",
    to:   "    const lf = leaf;",
  },
  {
    name: "#128 the lamp floats over the door",
    file: F('ship.js'),
    from: "                             : this.y - Door.H / 2 - Door.FRAME.header - L.h;",
    to:   "                             : this.y - Door.H / 2 - L.lift;",
  },
  {
    name: "#128 the door as thick as it was",
    file: F('ship.js'),
    from: "  static get DRAWN_W() { return 2; }   // thinner again in update128 (jj)",
    to:   "  static get DRAWN_W() { return 4; }",
  },
  {
    name: "#128 pests over the grille",
    file: F('ship.js'),
    from: "    this._drawVents(ctx, 'back');\n",
    to:   "    this._drawVents(ctx, 'front');\n",
  },
  {
    name: "#128 the cat drawn twice",
    file: F('ship.js'),
    from: "      if (c && c.isPet && c._ductY != null && !c.dead) return;   // drawn in the duct, behind the grille\n",
    to:   "",
  },
  {
    name: "#128 flat nacelles",
    file: F('ship.js'),
    from: "  NACELLE: { len: 6 * HULL_GRID.TILE, h: 22, overhang: 0 },   // bigger, flush (update128)",
    to:   "  NACELLE: { len: 5 * HULL_GRID.TILE, h: 16, overhang: 0 },",
  },
  {
    name: "#128 nacelles past the stern",
    file: F('ship.js'),
    from: "  NACELLE: { len: 6 * HULL_GRID.TILE, h: 22, overhang: 0 },   // bigger, flush (update128)",
    to:   "  NACELLE: { len: 6 * HULL_GRID.TILE, h: 22, overhang: 8 },",
  },
  {
    name: "#128 the egg shield",
    file: F('ship.js'),
    from: "      cells.forEach(c => hex(c.x, c.y, HS, c.n));\n      ctx.stroke();",
    to:   "      ctx.lineWidth = 2; ctx.ellipse(cx, cy, R, Q, 0, 0, Math.PI * 2);\n      ctx.stroke();",
  },
  {
    name: "#128 no dose animation",
    file: F('crew.js'),
    from: "              : (state === 'idle' && this._busyAct === 'heal' && this._busyT > 0 && !this.isPet) ? 'heal'   // update128",
    to:   "              : false ? 'heal'",
  },
  {
    name: "#128 no crosses off a dose",
    file: F('crew.js'),
    from: "        if (dosing) Particles.floatText?.(",
    to:   "        if (false) Particles.floatText?.(",
  },
  {
    name: "#128 a meal in two frames",
    file: F('crewart.js'),
    from: "    eat:     { view: 'front', fps: 3, loop: true,  poses: [{ eat: 2 }, { eat: 1 }, { eat: 1, chew: 1, bob: 1 }, { eat: 1 }] },",
    to:   "    eat:     { view: 'front', fps: 2, loop: true,  poses: [{ eat: 1 }, { eat: 1, bob: 1 }] },",
  },
  {
    name: "#128 the roof takes no gun",
    file: F('basescreen.js'),
    from: "      const roof = !m ? _loRoofAt(mx, my) : null;",
    to:   "      const roof = null;",
  },
  {
    name: "#128 no gun off the roof",
    file: F('basescreen.js'),
    from: "      if (f) { _hand = { kind: 'gun', from: 'mount', slot: roof.slot, key: f.defKey }; return true; }",
    to:   "      if (false) { _hand = null; }",
  },

  /* ── update130 — the fight panels (paczka C) ───────────────── */
  {
    name: '#130 their module strip hangs under their hull again',
    file: F('renderer.js'),
    from: "      _drawEnemyModules(ctx, e, { x: eX + 14, y: modTop });",
    to:   "      _drawEnemyModules(ctx, e);",
  },
  {
    name: '#130 their commander is not on their panel',
    file: F('renderer.js'),
    from: "      _drawFoeBadge(ctx, state, eX, 86);",
    to:   "      void 0;",
  },
  {
    name: '#130 our shields charge without a word',
    file: F('renderer.js'),
    from: "        _shieldChargeStrip(ctx, ship, 173, shieldY + 27, Math.max(22, ship.shieldMax * 30 - 8));",
    to:   "        void 0;",
  },
  {
    name: '#130 the charge strip never says how far',
    file: F('renderer.js'),
    // Re-aimed in update134: the systems panel says the same words, so the line is the strip's own.
    from: "    const txt = dead ? 'NO POWER' : full ? 'SHIELDS UP' : `CHARGING ${Math.round(prog * 100)}%`;",
    to:   "    const txt = dead ? 'NO POWER' : full ? 'SHIELDS UP' : 'CHARGING';",
  },
  {
    name: '#130 our readouts float loose again',
    file: F('renderer.js'),
    from: "      _hudPanel(ctx, 6, 6, right - 6, 94, '#1aff8c');\n      _ourPanelRect = { x: 6, y: 6, w: right - 6, h: 94 };",
    to:   "      void right;",
  },
  {
    name: '#130 He3 is the cut stone again',
    file: F('renderer.js'),
    from: "      drawStatIcon(ctx, 'he3', resX + 233, 17, 12, oreCol);",
    to:   "      drawStatIcon(ctx, 'ore', resX + 233, 17, 12, oreCol);",
  },
  {
    name: '#130 the rations in the hold are the mess tin again',
    file: F('renderer.js'),
    from: "      drawStatIcon(ctx, 'ration', resX + 346, 17, 12, fCol);",
    to:   "      drawStatIcon(ctx, 'eating', resX + 346, 17, 12, fCol);",
  },
  {
    name: '#130 the lying bar is not the core\'s own list',
    file: F('renderer.js'),
    from: "      ctx.fillStyle = pp.kind === 'free' && !big ? '#ff9040' : pp.fill;\n      fills.push(ctx.fillStyle);",
    to:   "      ctx.fillStyle = pp.kind === 'broken' ? '#cc2233' : '#ffb020';\n      fills.push(ctx.fillStyle);",
  },
  {
    name: '#130 a low enemy hull is under the log again',
    file: F('renderer.js'),
    from: "    else _enemyStripBottom = Math.max(_enemyStripBottom, b.y + b.h + 12);",
    to:   "    else void 0;",
  },

  /* ── update131 — the title screen chase is a fight (paczka D) ── */
  {
    name: "#131 the menu flies a bare hull, not the one on the contract",
    file: F('game.js'),
    from: "    if (run?.shipKey === key && run.ship) return { key, data: run.ship, crew: run.crew ?? [] };",
    to:   "    void run;",
  },
  {
    name: "#131 the menu hull is cached on its kind alone again",
    file: F('game.js'),
    from: "    if (!_menuShip || _menuShipKey !== src.key || _menuShipSrc !== src.data) {",
    to:   "    if (!_menuShip || _menuShipKey !== src.key) {",
  },
  {
    name: "#131 your guns point forward, away from the raider",
    file: F('game.js'),
    from: "        _menuShip.gunsFace = -1;             // you shoot back over the stern",
    to:   "        void 0;",
  },
  {
    name: "#131 the gun mounts ignore which way they face",
    file: F('ship.js'),
    from: "    const dir = this.gunsFace ?? (this.isPlayer ? 1 : -1);      // point at the enemy",
    to:   "    const dir = this.isPlayer ? 1 : -1;      // point at the enemy",
  },
  {
    name: "#131 the raider flies unfitted",
    file: F('game.js'),
    from: "        _menuFit(_menuFoe);",
    to:   "        void 0;",
  },
  {
    name: "#131 the raider is empty and its shield down",
    file: F('game.js'),
    from: "        _menuMan(_menuFoe, makeStartingCrew().map(c => c.serialise()));",
    to:   "        void 0;",
  },
  {
    name: "#131 the menu hums while it mans the hull",
    file: F('game.js'),
    from: "    ship.weapons = [];                        // no charging hum on the title screen",
    to:   "    void 0;",
  },
  {
    name: "#131 the menu fight really damages the hulls",
    file: F('game.js'),
    from: "        if (p._menu.room) p._menu.room._hitFlash = 1;",
    to:   "        (p._menu.target === 'you' ? you : foe).receiveHit?.(p);",
  },
  {
    name: "#131 the shield never falls",
    file: F('game.js'),
    from: "          ss._shieldBars = Math.max(0, ss._shieldBars - 1); ss._shieldTimer = 0;",
    to:   "          void ss;",
  },
  {
    name: "#131 a fallen layer never comes back",
    file: F('game.js'),
    from: "        if (ss._shieldTimer >= C.shieldBack) { ss._shieldBars++; ss._shieldTimer = 0; }",
    to:   "        void 0;",
  },
  {
    name: "#131 they fire off the screen",
    file: F('game.js'),
    from: "        if (st.charge < 1 || !live || S.shots.length >= C.maxShots) return;",
    to:   "        if (st.charge < 1 || S.shots.length >= C.maxShots) return;",
  },
  {
    name: "#131 nothing is ever dodged",
    file: F('game.js'),
    from: "        if (Math.random() < C.evade) {",
    to:   "        if (false) {",
  },
  {
    name: "#131 no muzzle flash on the title screen",
    file: F('game.js'),
    from: "        WeaponArt.add({ kind: 'muzzle', x: src.x, y: src.y, dir: q.m.dir,",
    to:   "        ({ kind: 'muzzle', x: src.x, y: src.y, dir: q.m.dir,",
  },
  {
    name: "#131 the guns on the hull never show their charge",
    file: F('game.js'),
    from: "        w.charge = st.charge; w.armed = false;          // its boxes on the hull fill (picture only)",
    to:   "        void 0;",
  },
  {
    name: "#131 the roof lifts through the NEW GAME question",
    file: F('game.js'),
    from: "    S.hovered = _menuConfirm ? null : inR(_menuHullRect(f)) ? 'you' : inR(_menuHullRect(f.foe)) ? 'foe' : null;",
    to:   "    S.hovered = inR(_menuHullRect(f)) ? 'you' : inR(_menuHullRect(f.foe)) ? 'foe' : null;",
  },
  {
    name: "#131 the roof never lifts",
    file: F('game.js'),
    from: "      const want = S.hovered === k ? 0 : 1;",
    to:   "      const want = 1;",
  },
  {
    name: "#131 the roof snaps instead of easing",
    file: F('game.js'),
    from: "      const step = dt * C.roofSpeed;",
    to:   "      const step = 1;",
  },
  {
    name: "#131 the menu is not ticked at all",
    file: F('game.js'),
    from: "    try { _menuFightTick(dt); } catch (e) { /* a picture never stops the menu */ }",
    to:   "    void dt;",
  },

  /* ── update132 — a longer, wider sector map ── */
  {
    name: "#132 the sector is the old six by three",
    file: F('map.js'),
    from: "  static get GRID() { return { cols: 9, rows: 5, w: 900, h: 330, margin: 35 }; }",
    to:   "  static get GRID() { return { cols: 6, rows: 3, w: 700, h: 400, margin: 80 }; }",
  },
  {
    name: "#132 a bigger map grows more stations",
    file: F('map.js'),
    from: "  static get STORE_THIN() { return 3; }",
    to:   "  static get STORE_THIN() { return 1; }",
  },
  {
    name: "#132 the boss sits in row one again",
    file: F('map.js'),
    from: "            if (row !== MID_ROW) { grid[col][row] = null; continue; }",
    to:   "            if (row !== 1) { grid[col][row] = null; continue; }",
  },
  {
    name: "#132 the click reads the old map rectangle",
    file: F('game.js'),
    from: "    const { x: ox, y: oy } = SectorMap.origin(Renderer.getWidth(), Renderer.getHeight());",
    to:   "    const ox = (Renderer.getWidth() - 700) / 2, oy = (Renderer.getHeight() - 400) / 2;",
  },
  {
    name: "#132 the screen draws at the old map rectangle",
    file: F('renderer.js'),
    from: "    const org = SectorMap.origin(_W, _H);",
    to:   "    const org = { x: (_W - 700) / 2, y: (_H - 400) / 2 };",
  },
  {
    name: "#132 a new sector starts in lane one again",
    file: F('game.js'),
    from: "    _sectorMap = new SectorMap(next, Save.getRun().seed, Save.getRun().lane ?? SectorMap.MID_LANE, final,",
    to:   "    _sectorMap = new SectorMap(next, Save.getRun().seed, Save.getRun().lane ?? 1, final,",
  },
  {
    name: "#132 the lane notice knows only three lanes",
    file: F('game.js'),
    from: "UI.notify(`Starting lane locked in \u2014 ${SectorMap.laneName(node.row)}`, 'good');",
    to:   "UI.notify(`Starting lane locked in \u2014 ${['TOP','MIDDLE','BOTTOM'][node.row]}`, 'good');",
  },
  {
    name: "#132 the station is not thinned at all",
    file: F('map.js'),
    from: "      const n = t === 'store' ? def.weight : def.weight * thin;",
    to:   "      const n = def.weight * thin;",
  },

  /* ── update133 — jj's answers: console HP, the serum, corporation signs ── */
  {
    name: "#133 full boxes over every man at his console again",
    file: F('crew.js'),
    from: "    const quietAtPost = this._animKey === 'operate' && (this.hp ?? 0) >= (this.maxHp || 1);",
    to:   "    const quietAtPost = false;",
  },
  {
    name: "#133 a hurt man at his console loses his boxes too",
    file: F('crew.js'),
    from: "    const quietAtPost = this._animKey === 'operate' && (this.hp ?? 0) >= (this.maxHp || 1);",
    to:   "    const quietAtPost = this._animKey === 'operate';",
  },
  {
    name: "#133 the serum never turns up in a wreck",
    file: F('cargo.js'),
    from: "    ['antiviral_serum', 1],",
    to:   "",
  },
  {
    name: "#133 the serum is common",
    file: F('cargo.js'),
    from: "    ['antiviral_serum', 1],",
    to:   "    ['antiviral_serum', 12],",
  },
  {
    name: "#133 the serum does nothing",
    file: F('game.js'),
    from: "      sick.cureVirus();\n      return { ok: true, consumed: true, message: `${sick.name} is clean \u2014 the virus is out of him` };",
    to:   "      return { ok: true, consumed: true, message: `${sick.name} is clean \u2014 the virus is out of him` };",
  },
  {
    name: "#133 the serum goes to the first man, not the one nearest the egg",
    file: F('game.js'),
    from: "        .sort((a, b) => (a.virusT ?? 0) - (b.virusT ?? 0))[0];",
    to:   "[0];",
  },
  {
    name: "#133 the serum is spent on nobody",
    file: F('game.js'),
    from: "      if (!sick) return { ok: false, message: 'Nobody aboard carries the virus' };",
    to:   "      if (!sick) return { ok: true, consumed: true, message: 'Nobody aboard carries the virus' };",
  },
  {
    name: "#133 no sign before the names in the fight's crew list",
    file: F('renderer.js'),
    from: "      const gx = drawCorpGlyph(ctx, c, cx + 28, crewY + 4, 9) ? 12 : 0;",
    to:   "      const gx = 0;",
  },
  {
    name: "#133 no sign before the name on a crew card",
    file: F('renderer.js'),
    from: "    const gx = drawCorpGlyph(ctx, rec, tx, nameY - gs + 1, gs) ? gs + 4 : 0;",
    to:   "    const gx = 0;",
  },
  {
    name: "#133 no sign on their commander",
    file: F('renderer.js'),
    from: "      drawCorpGlyph(ctx, foe, x2 + 3, y2 + 3, 14);      // his house's sign (update133)",
    to:   "      void 0;",
  },
  {
    name: "#133 two houses share one sign",
    file: F('renderer.js'),
    from: "    corp_terra:    [['circle', 5, 5, 4.1, false], ['line', 5, 0.9, 5, 9.1], ['line', 0.9, 5, 9.1, 5]],",
    to:   "    corp_terra:    [['poly', [5,0.4, 7.4,4, 8.4,6.2, 7.6,8.4, 5,9.6, 2.4,8.4, 1.6,6.2, 2.6,4], true]],",
  },
  {
    name: "#133 the medkit still says only a clinic cures the bite",
    file: F('cargo.js'),
    from: "        + 'a research post, or a vial of antiviral serum.',",
    to:   "        + 'a research post.',",
  },

  /* ── update134 — the systems panel (Starfield) ── */
  {
    name: "#134 the old row is back as the default",
    file: F('renderer.js'),
    from: "  let _reactorLayout = 'S';",
    to:   "  let _reactorLayout = 'A';",
  },
  {
    name: "#134 the crew list stays low with nothing above it",
    file: F('renderer.js'),
    from: "    let crewY = _reactorLayout === 'S' ? 14 : 108;",
    to:   "    let crewY = 108;",
  },
  {
    name: "#134 the crew list runs into the panel",
    file: F('renderer.js'),
    from: "    if (_reactorLayout === 'S') return _H - 8 - SYS_PANEL.h - 8;   // above the systems panel (update134)",
    to:   "    void 0;",
  },
  {
    name: "#134 the top-left readouts draw over the crew list again",
    file: F('renderer.js'),
    from: "    if (_reactorLayout !== 'S') {        // in the systems panel since update134",
    to:   "    if (true) {",
  },
  {
    name: "#134 the panel has no hull",
    file: F('renderer.js'),
    // Re-aimed in update135: the panel is drawn in shared rows now.
    from: "    ctx.fillText(`${ship.hull}/${max}`, x0 + W - 10, hy + 8);",
    to:   "    void max;",
  },
  {
    name: "#134 the panel forgets the gravity",
    file: F('renderer.js'),
    // Re-aimed in update135: the panel is drawn in shared rows now.
    from: "    if (ship.gravityActive) { if (ship.isPlayer) { ctx.fillStyle = '#4a8a6a'; ctx.fillText('GRAV ON', x0 + W - 10, ry); } }",
    to:   "    if (ship.gravityActive) { void 0; }",
  },
  {
    name: "#134 the panel pips cannot be clicked",
    file: F('renderer.js'),
    // Re-aimed in update135: the panel is drawn in shared rows now.
    from: "      if (clickable && !damaged) _powerClickZones.push({ x: px - 3, y: py - 1, w: g.pipW + 6, h: g.pipH + 2, sysIndex: ship.systems.indexOf(sys), pip: p });",
    to:   "      void 0;",
  },
  {
    name: "#134 the core in the panel cannot be scrammed",
    file: F('renderer.js'),
    // Re-aimed in update135: the panel is drawn in shared rows now.
    from: "    if (clickable) _powerClickZones.push({ x: rx - rr, y: ry - 2, w: rr * 2, h: rr * 2, reactorToggle: true });",
    to:   "    void rr;",
  },
  {
    name: "#134 the gun cards land on the panel",
    file: F('renderer.js'),
    // Re-aimed in update135: the panel is drawn in shared rows now.
    from: "      ctx.textAlign = 'center';\n    }\n    return x0 + W;\n  }",
    to:   "      ctx.textAlign = 'center';\n    }\n    return x0;\n  }",
  },
  {
    name: "#134 the shield blocks never say how far",
    file: F('renderer.js'),
    // Re-aimed in update135: the panel is drawn in shared rows now.
    from: "      const txt = dead ? 'NO POWER' : full ? 'UP' : `${Math.round(prog * 100)}%`;",
    to:   "      const txt = dead ? 'NO POWER' : full ? 'UP' : 'CHARGING';",
  },
  {
    name: "#134 no names under the columns",
    file: F('renderer.js'),
    // Re-aimed in update135: the panel is drawn in shared rows now.
    from: "    ctx.fillText(label.text, mid, fBot + 9);",
    to:   "    void label;",
  },
  {
    name: "#134 a broken module draws no red frame",
    file: F('renderer.js'),
    // Re-aimed in update135: the panel is drawn in shared rows now.
    from: "    ctx.strokeStyle = broken ? '#663333' : running ? (ship.isPlayer ? '#ffb020' : '#aa5522') : '#4a6080';",
    to:   "    ctx.strokeStyle = running ? (ship.isPlayer ? '#ffb020' : '#aa5522') : '#4a6080';",
  },

  /* ── update135 — their systems panel; a crook conned pays karma ── */
  {
    name: "#135 their panel is the old readout again",
    file: F('renderer.js'),
    from: "      _drawFoeSystemsPanel(ctx, state, state.enemyShip);       // update135",
    to:   "      void 0;",
  },
  {
    name: "#135 their panel can be clicked",
    file: F('renderer.js'),
    from: "    const bar = _sysReactorRow(ctx, e, x0, fBot + 15, x0 + 12 + colsW, W, false);",
    to:   "    const bar = _sysReactorRow(ctx, e, x0, fBot + 15, x0 + 12 + colsW, W, true);",
  },
  {
    name: "#135 their panel forgets their commander",
    file: F('renderer.js'),
    from: "      if (foeCap) _drawFoeBadge(ctx, state, x0 + 10, y0 + 40);",
    to:   "      void 0;",
  },
  {
    name: "#135 their panel forgets the armour",
    file: F('renderer.js'),
    from: "        ctx.fillText('ARMOUR', x0 + W - 66, y0 + 54);",
    to:   "        void 0;",
  },
  {
    name: "#135 their core bar is not theirs",
    file: F('renderer.js'),
    from: "    _enemyReactorBar = bar;\n    _enemyHeatBar = { ...bar.track, heat: bar.heat, filled: bar.filled, lying: true };",
    to:   "    void bar;",
  },
  {
    name: "#135 the log sits on a low enemy hull again",
    file: F('renderer.js'),
    from: "    const b = e.roomBounds();\n    _enemyStripBottom = Math.max(_enemyStripBottom, b.y + b.h + 12);\n  }",
    to:   "  }",
  },
  {
    name: "#135 their panel runs off the right edge",
    file: F('renderer.js'),
    from: "    const x0 = _W - 6 - W, y0 = 6;\n    _enemyPanelRect",
    to:   "    const x0 = _W - 6 - W + 40, y0 = 6;\n    _enemyPanelRect",
  },
  {
    name: "#135 the con costs karma again",
    file: F('commander.js'),
    from: "    CON_A_CROOK:    5,",
    to:   "    CON_A_CROOK:   -5,",
  },
  /* ── update136 — the event window: a face that talks, text that types ── */
  {
    name: "#136 a click while he talks takes the choice",
    file: F('game.js'),
    from: "    if (!L.ready) {\n      /* not the click",
    to:   "    if (false) {\n      /* not the click",
  },
  {
    name: "#136 the click that opened it skips him",
    file: F('game.js'),
    from: "      if ((EventView.view()?.t ?? 0) < 0.15) return;\n",
    to:   "\n",
  },
  {
    name: "#136 the text is out at once",
    file: F('eventview.js'),
    from: "    if (!text.length) _v.doneAt = 0;",
    to:   "    _v.idx = text.length; _v.doneAt = 0;",
  },
  {
    name: "#136 no breath after a full stop",
    file: F('eventview.js'),
    from: "    if (BREATH[ch] && (next === ' ' || next === '\"' || next === undefined)) return base + BREATH[ch];",
    to:   "    void BREATH;",
  },
  {
    name: "#136 the words in quotes are ours",
    file: F('eventview.js'),
    from: "      out[i] = (inQ && hasThem) ? 'them' : (hasUs ? 'us' : null);",
    to:   "      out[i] = hasUs ? 'us' : null;",
  },
  {
    name: "#136 the mouth does not follow the letter",
    file: F('eventview.js'),
    from: "      m.shape = talking ? mouthFor(_v.lastChar) : null;",
    to:   "      m.shape = null;",
  },
  {
    name: "#136 skip does not finish the sentence",
    file: F('eventview.js'),
    from: "    _v.idx = _v.text.length;\n    _v.doneAt = _v.t;",
    to:   "    _v.doneAt = _v.t;",
  },
  {
    name: "#136 the choices sit on the text",
    file: F('eventview.js'),
    from: "    const cy = by + bodyH + 16;",
    to:   "    const cy = by + bodyH - 40;",
  },
  {
    name: "#136 the resting mouth is painted under the talking one",
    file: F('crewart.js'),
    from: "    const m = talking ? null : f.mouth;",
    to:   "    const m = f.mouth;",
  },
  {
    name: "#136 he never blinks",
    file: F('crewart.js'),
    from: "      if (f.blink) { P(ex, ey, 5, eh + 1, sk);",
    to:   "      if (false) { P(ex, ey, 5, eh + 1, sk);",
  },
  {
    name: "#136 the dock hand is mute",
    file: F('map.js'),
    from: "    speaker: { seed: 0x5a17, role: 'DOCK HAND', colour: '#8a7a52' },\n",
    to:   "",
  },
  {
    name: "#136 the hail has no face",
    file: F('game.js'),
    from: "      speaker: _foeSpeaker('ON CHANNEL'),\n",
    to:   "",
  },
  {
    name: "#136 number keys do not choose",
    file: F('game.js'),
    from: "    for (let i = 0; i < Math.min(9, _event.choices.length) && pick < 0; i++) if (key(i)) pick = i;",
    to:   "    void key;",
  },
  {
    name: "#136 the late loader forgets the event window",
    file: F('game.js'),
    from: "    { name: 'EventView',    src: 'js/eventview.js' },\n",
    to:   "",
  },
  {
    name: "#136 nobody of ours reports it",
    file: F('game.js'),
    from: "    const man = people.find(c => roomOf(c) === 'piloting') ?? people[0] ?? null;",
    to:   "    const man = null; void roomOf;",
  },
  /* ── update137 — regolith: a grey moon, four colours that mean something ── */
  {
    name: "#137 regolith changes nothing",
    file: F('palette.js'),
    from: "    if (_mode !== 'regolith' || _bypass > 0 || typeof css !== 'string') return css;",
    to:   "    return css;",
  },
  {
    name: "#137 the violet keeps its colour",
    file: F('palette.js'),
    from: "    if (h >= 250 && h < 320) return 'grey';                 // violet: means nothing\n",
    to:   "",
  },
  {
    name: "#137 a faint line is made bright",
    file: F('palette.js'),
    from: "        const k = Math.min(1, lum(c) / lum(t));             // never brighter than it was",
    to:   "        const k = 1;",
  },
  {
    name: "#137 a grey panel turns solid",
    file: F('palette.js'),
    from: "      if (job === 'grey') res = out(grey(lum(c)), c.a);",
    to:   "      if (job === 'grey') res = out(grey(lum(c)), 1);",
  },
  {
    name: "#137 the face goes through the filter",
    file: F('eventview.js'),
    from: "      if (typeof Palette !== 'undefined') Palette.raw(paint); else paint();",
    to:   "      paint();",
  },
  {
    name: "#137 the screen has no filter",
    file: F('renderer.js'),
    from: "    if (typeof Palette !== 'undefined') Palette.install(_ctx);",
    to:   "    void 0;",
  },


  {
    name: "#137 ESC to go back across the buttons",
    file: F('game.js'),
    from: "    ctx.fillText('ESC to go back', W / 2, _optBackRect().y + _optBackRect().h + 22);",
    to:   "    ctx.fillText('ESC to go back', W / 2, OPT_BAR.top + 4 * OPT_BAR.gap + 86);",
  },
  {
    name: "#137 the hull art keeps its paint",
    file: F('palette.js'),
    from: "            p[i] = t.r; p[i + 1] = t.g; p[i + 2] = t.b;",
    to:   "            void t;",
    browser: true,
  },
  {
    name: "#137 pictures skip the filter",
    file: F('palette.js'),
    from: "        if (_mode === 'regolith' && _bypass === 0 && isFileImage(img) && img.complete !== false) {",
    to:   "        if (false) {",
    browser: true,
  },
  /* ── update138 — jj's list of 19.10 ── */
  {
    name: "#138 the preview is heard",
    file: F('basescreen.js'),
    from: "        if (Audio.hush) Audio.hush(run); else run();",
    to:   "        run();",
  },
  {
    name: "#138 one picture for every place",
    file: F('basescreen.js'),
    from: "    if (kept && kept.key === key) { _preview = kept.ship; _previewKey = key; return _preview; }",
    to:   "    void kept;",
  },
  {
    name: "#138 the hangar drawn under the briefing",
    file: F('basescreen.js'),
    from: "    if (!_screen) {\n      if (_tab === 'HANGAR')",
    to:   "    if (true) {\n      if (_tab === 'HANGAR')",
  },
  {
    name: "#138 hush hushes nothing",
    file: F('audio.js'),
    from: "  function hushed() { return _hush > 0; }",
    to:   "  function hushed() { return false; }",
  },
  {
    name: "#138 their FTL bar back on their panel",
    file: F('game.js'),
    from: "      const ey = EP ? EP.y + EP.h + 6 : 84;",
    to:   "      const ey = 84;",
  },
  {
    name: "#138 their FTL bar wider than their panel",
    file: F('game.js'),
    from: "      const ew = EP ? Math.max(220, Math.round(EP.w)) : 300, eh = 24;",
    to:   "      const ew = 300, eh = 24;",
  },
  {
    name: "#138 the man walks through the shut hatch",
    file: F('game.js'),
    from: "        if (!m.hatch.open) {\n          m.waitT += dt;",
    to:   "        if (false) {\n          m.waitT += dt;",
  },
  {
    name: "#138 a man in the hatch is left behind on a jump",
    file: F('game.js'),
    from: "      CombatManager.salvage.men.filter(m => m.phase === 'hatch').forEach(m => { _salvageToDeck(m); _salvageRelease(m); });\n",
    to:   "",
  },
  {
    name: "#138 the charge floats over the gun again",
    file: F('weapons.js'),
    from: "    if (onHull) { this._drawHullCharge(ctx, x, y, w, h, dir, col, secs); return; }\n",
    to:   "",
  },
  {
    name: "#138 the mounts spaced by the old strip",
    file: F('ship.js'),
    from: "    const widths = mounted.map(() => GW);",
    to:   "    const widths = mounted.map(w => Math.max(GW, w.chargeStripWidth?.() ?? GW));",
  },
  {
    name: "#138 Aquarius is a ring again",
    file: F('renderer.js'),
    from: "    corp_aquarius: [['poly', [5,0.4, 7.4,4, 8.4,6.2, 7.6,8.4, 5,9.6, 2.4,8.4, 1.6,6.2, 2.6,4], true]],",
    to:   "    corp_aquarius: [['circle', 5, 5, 3.6, false], ['circle', 5, 5, 1.1, true]],",
  },
  {
    name: "#138 a won fight leaves the ship in view",
    file: F('game.js'),
    from: "        _saveShip(); _leaveFight('map'); Audio.playMusic('explore');\n      }\n    }",
    to:   "        _saveShip(); _leaveFight(); Audio.playMusic('explore');\n      }\n    }",
  },
  {
    name: "#138 the question stays up after he looks at the ship",
    file: F('game.js'),
    from: "      _mapView = _mapView === 'map' ? 'ship' : 'map';\n      _jumpPrompt = false;",
    to:   "      _mapView = _mapView === 'map' ? 'ship' : 'map';",
  },
  {
    name: "#138 the question sits on the chart's title row",
    file: F('game.js'),
    from: "    return { x: W / 2 - 170, y: o.y + G.h + 24 + 6, w: 340, h: 28 };",
    to:   "    return { x: W / 2 - 170, y: 92, w: 340, h: 30 };",
  },
  {
    name: "#138 the commander's panel back at the top",
    file: F('renderer.js'),
    from: "  function _compactCmd() { return _reactorLayout === 'S'; }",
    to:   "  function _compactCmd() { return false; }",
  },
  {
    name: "#138 an empty second row is drawn anyway",
    file: F('renderer.js'),
    from: "      const row2 = nS + nT > 0;",
    to:   "      const row2 = true;",
  },
  {
    name: "#138 the crew drawn under the panel",
    file: F('renderer.js'),
    from: "    if (_compactCmd() && _commanderBarShown(state)) { const cb = commanderBarRects().bar; crewY = cb.y + cb.h + 8; }",
    to:   "    void 0;",
  },
  {
    name: "#138 a one-row panel says NO SPECIALISATIONS",
    file: F('renderer.js'),
    from: "    if (!R.specials.length && !R.compact) {",
    to:   "    if (!R.specials.length) {",
  },
  {
    name: "#138 the COLOURS switch is back",
    file: F('game.js'),
    from: "  const PALETTE_SWITCH = false;",
    to:   "  const PALETTE_SWITCH = true;",
  },
  /* ── update139 — the node card ── */
  {
    name: "#139 the old box under the pointer",
    file: F('renderer.js'),
    from: "        if (typeof NodeView !== 'undefined') {\n          _nodeCard = NodeView.draw(",
    to:   "        if (false) {\n          _nodeCard = NodeView.draw(",
  },
  {
    name: "#139 the late loader forgets the node card",
    file: F('game.js'),
    from: "    { name: 'NodeView',     src: 'js/nodeview.js' },\n",
    to:   "",
  },
  {
    name: "#139 the event card gives the event away",
    file: F('nodeview.js'),
    from: "    return BLURB[k].slice();",
    to:   "    return node.event ? [String(node.event.title), BLURB[k][1]] : BLURB[k].slice();",
  },
  {
    name: "#139 the poster loses his price",
    file: F('nodeview.js'),
    from: "      return [`Bounty ${w.bounty} CC alive · ${Math.round(w.bounty / 2)} dead.`,",
    to:   "      return [`Bounty on his head.`,",
  },
  {
    name: "#139 a wanted node is just an enemy",
    file: F('nodeview.js'),
    from: "    if (node.wanted) return 'wanted';\n",
    to:   "",
  },
  {
    name: "#139 the card runs off the chart",
    file: F('nodeview.js'),
    from: "    if (x + CARD.w > B.x + B.w - 4) x = at.x - 26 - CARD.w;      // flip to the left near the right edge",
    to:   "    void B;",
  },
  {
    name: "#139 the foot forgets the fuel",
    file: F('nodeview.js'),
    from: "    else if (fuel != null && fuel <= 0) { foot = 'JUMP · 1 He2 — the tanks are dry'; footCol = COL.bad; }\n",
    to:   "",
  },
  {
    name: "#139 the picture stands still",
    file: F('nodeview.js'),
    from: "    _stars(ctx, P, seed, t);\n    const cx = P.x + P.w / 2, cy = P.y + P.h / 2;",
    to:   "    t = 0; _stars(ctx, P, seed, t);\n    const cx = P.x + P.w / 2, cy = P.y + P.h / 2;",
  },
  {
    name: "#139 every node gets the quiet field",
    file: F('nodeview.js'),
    from: "    return BLURB[node.type] ? node.type : 'empty';",
    to:   "    return 'empty';",
  },
  {
    name: "#139 a locked node gets a card",
    file: F('renderer.js'),
    from: "      if (node && !node.locked && sectorMap.visibilityOf?.(node) === 'known') {\n        if (typeof NodeView",
    to:   "      if (node && sectorMap.visibilityOf?.(node) === 'known') {\n        if (typeof NodeView",
  },
  {
    name: "#139 YOU ARE HERE never said",
    file: F('nodeview.js'),
    from: "    if (here) { foot = 'You are here.'; footCol = COL.faint; }\n",
    to:   "",
  },
  /* ── update140 — the picture of what happened ── */
  {
    name: "#140 the frame says image again",
    file: F('game.js'),
    from: "    else if (typeof RewardView !== 'undefined' && _eventResult.pic) {",
    to:   "    else if (false) {",
  },
  {
    name: "#140 the picture is the offer, not the outcome",
    file: F('game.js'),
    from: "      const diff = _outcomeDiff(before, _outcomeSnapshot());",
    to:   "      const diff = { cc: choice?.result?.scrap ?? 0, newPets: choice?.result?.pet ? [{ isPet: true, name: 'cat' }] : [] };",
  },
  {
    name: "#140 a new man is not seen",
    file: F('game.js'),
    from: "      newCrew: added.filter(c => !c.isPet), newPets: added.filter(c => c.isPet),",
    to:   "      newCrew: [], newPets: added.filter(c => c.isPet),",
  },
  {
    name: "#140 credits outrank a new man",
    file: F('rewardview.js'),
    from: "    if (d.newCrew?.length) return { kind: 'crew', rec: d.newCrew[0], badge: d.newCrew.length > 1 ? `+${d.newCrew.length} CREW` : 'NEW CREW' };\n",
    to:   "",
  },
  {
    name: "#140 a payment drawn as income",
    file: F('rewardview.js'),
    from: "    if ((d.cc ?? 0) > 0) return { kind: 'cc', badge: `+${d.cc} CC` };",
    to:   "    if ((d.cc ?? 0) !== 0) return { kind: 'cc', badge: `+${d.cc} CC` };",
  },
  {
    name: "#140 the badge is not drawn",
    file: F('rewardview.js'),
    from: "    if (pic?.badge) {\n      ctx.font = 'bold 11px",
    to:   "    if (false) {\n      ctx.font = 'bold 11px",
  },
  {
    name: "#140 the picture stands still",
    file: F('rewardview.js'),
    from: "    _bg(ctx, A, kind, t);\n",
    to:   "    t = 0; _bg(ctx, A, kind, t);\n",
  },
  {
    name: "#140 the hurt are not counted",
    file: F('game.js'),
    from: "    a.hp.forEach((hp, c) => { if ((sh?.crew ?? []).includes(c)) hpLost += Math.max(0, hp - (c.hp ?? 0)); });\n",
    to:   "",
  },
  {
    name: "#140 the late loader forgets the picture",
    file: F('game.js'),
    from: "    { name: 'RewardView',   src: 'js/rewardview.js' },\n",
    to:   "",
  },
  /* ── update141 — the base, first pass ── */
  {
    name: "#141 the shop's buttons under their label again",
    file: F('basescreen.js'),
    from: "      const bx5 = x + cardW - pad - BW, bx1 = bx5 - GAP - BW, by = ly - 12;",
    to:   "      const bx5 = x + pad + BW + GAP, bx1 = x + pad, by = ly + 10;",
  },
  {
    name: "#141 the shop's rows on top of each other",
    file: F('basescreen.js'),
    from: "      ly += PITCH;\n    });\n  }",
    to:   "      ly += 30;\n    });\n  }",
  },
  {
    name: "#141 the rank marks on the name",
    file: F('renderer.js'),
    from: "      let mx = tx + gx + (ctx.measureText?.(nm)?.width ?? 40) + 6;",
    to:   "      let mx = tx + (ctx.measureText?.(nm)?.width ?? 40) + 6;",
  },
  {
    name: "#141 skill names cut at five",
    file: F('renderer.js'),
    from: "          ctx.fillText(skillShort(k), bx + 10, by + 8);",
    to:   "          ctx.fillText(SKILL_DEFS[k].label.slice(0, 5), bx + 10, by + 8);",
  },
  {
    name: "#141 a poster without a face",
    file: F('basescreen.js'),
    from: "        CrewArt.portrait(ctx, fx, fy, '#a83a44', CrewArt.faceOf(CrewArt.seedOf({ name: w.name, race: w.race }), w.race ?? null), S);",
    to:   "        void S;",
  },
  {
    name: "#141 the poster loses the alive price",
    file: F('basescreen.js'),
    from: "      ctx.fillText(`${w.bounty} CC alive`, x + cw / 2, y + chH - 26);",
    to:   "      void 0;",
  },
  {
    name: "#141 no empty peg",
    file: F('basescreen.js'),
    from: "    for (let i = N; i < (Save.WANTED_MAX ?? 4); i++) {",
    to:   "    for (let i = N; i < N; i++) {",
  },
  {
    name: "#141 the upgrade cards empty again",
    file: F('basescreen.js'),
    from: "      _upgradeViz(ctx, it.kind, x + pad, ly + 16, inner, (y + cardH - 52) - (ly + 16), can);\n",
    to:   "",
  },
  {
    name: "#141 no free bunks",
    file: F('basescreen.js'),
    from: "      const free = Math.max(0, Base.barracksCap() - b.barracks.length);",
    to:   "      const free = 0;",
  },
  {
    name: "#141 the yard's words on one line",
    file: F('basescreen.js'),
    from: "        lines: [{ text: def.blurb || '' }], wrap: true,",
    to:   "        lines: [{ text: def.blurb || '' }],",
  },
];
/* ── WHAT EACH REVERT COSTS, AND WHY (update72) ──────────────
 *
 * One full run used to be 368 reverts x three suites, and the three
 * suites are not the same price at all:
 *
 *     run_tests.js    9.3 s     caught 7000 of the 7003 reverts ever
 *     smoke_draw.js   0.3 s     caught none — it is a crash net
 *     browser_test.js 19.1 s    caught THREE, all of them the shop
 *
 * So two thirds of a three-hour run was a browser starting up 368
 * times to answer a question it has answered three times in the
 * project's history. It still runs — on the BASELINE, where a real
 * Chromium is the only thing that can see a broken <script> tag or a
 * DOM shop that will not open — and per revert only where the fix it
 * guards actually lives, which is the handful marked `browser: true`.
 *
 * If a revert is ever reported as NOT CAUGHT and the missing test is a
 * browser one, the answer is to mark that revert rather than to put
 * the browser back in front of all 368. The leak report is what tells
 * you; that is the whole point of it.
 */
const SUITES_BASELINE = ['run_tests.js', 'smoke_draw.js', 'browser_test.js'];
const SUITES_FAST     = ['run_tests.js', 'smoke_draw.js'];

function runSuites(list = SUITES_FAST) {
  for (const s of list) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, s)],
                   { stdio: 'pipe', timeout: 180000 });
    } catch (e) {
      return { failed: true, suite: s };
    }
  }
  return { failed: false };
}

// ── Baseline: everything must be green before we start ──
console.log('baseline…');
{
  const base = runSuites(SUITES_BASELINE);
  if (base.failed) {
    console.log(`REFUSING TO RUN: ${base.suite} is already red on a clean tree.`);
    process.exit(2);
  }
  console.log('baseline green\n');
}

/* An optional substring filter, so a single revert can be re-checked in
   seconds instead of re-running all of them: `node tests/break_check.js "#68 the menu"`.
   With no argument every revert runs, exactly as before. */
const ARGS = process.argv.slice(2);
/* ── SPLIT THE RUN ACROSS TWO TREES (update72) ───────────────
 * `--shard=1/2` takes every other revert. Each shard must be its own
 * CHECKOUT: a revert writes to js/ and puts it back, so two shards in
 * one directory would be breaking each other's files rather than the
 * code under test. Unpack with `git archive HEAD` and run one shard in
 * each, then read the two leak lists together. */
const shardArg = ARGS.find(a => a.startsWith('--shard='));
const [SHARD_I, SHARD_N] = shardArg
  ? shardArg.slice(8).split('/').map(Number) : [1, 1];
const FILTER = ARGS.filter(a => !a.startsWith('--')).join(' ').trim();

const leaks = [];
let ran = 0;
let seen = 0;
for (const b of BREAKS) {
  if (FILTER && !b.name.includes(FILTER)) continue;
  if (SHARD_N > 1 && (seen++ % SHARD_N) !== (SHARD_I - 1)) continue;
  ran++;
  const src = fs.readFileSync(b.file, 'utf8');
  const hits = src.split(b.from).length - 1;
  if (hits !== 1) {
    console.log(`!! ANCHOR ${hits === 0 ? 'MISSING' : 'AMBIGUOUS'} (${hits}): ${b.name}`);
    leaks.push(`${b.name}  [anchor ${hits === 0 ? 'missing' : 'ambiguous'}]`);
    continue;
  }
  fs.writeFileSync(b.file, src.replace(b.from, b.to));
  let res;
  try {
    res = runSuites(b.browser ? SUITES_BASELINE : SUITES_FAST);
  } finally {
    fs.writeFileSync(b.file, src);      // always put it back
  }
  if (res.failed) {
    console.log(`  caught  (${res.suite})  ${b.name}`);
  } else {
    console.log(`  LEAK              ${b.name}`);
    leaks.push(b.name);
  }
}

console.log(`\n${ran - leaks.length}/${ran} reverts caught by the tests`);
if (leaks.length) {
  console.log('\nNOT CAUGHT — these fixes have no test that fails without them:');
  leaks.forEach(l => console.log('  · ' + l));
}
process.exit(leaks.length ? 1 : 0);
