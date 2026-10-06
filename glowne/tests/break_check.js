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
    from: "      const km  = _hasCommander() ? (c.result?.karma || 0) : 0;",
    to:   "      const km  = (c.result?.karma || 0);",
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
    from: "    for (let i = 0; i < n; i++) {\n      ctx.fillStyle = i < lit ? col : '#1a2030';\n      ctx.fillRect(x + i * (bw + gap), y, bw, h);\n    }",
    to:   "    ctx.fillStyle = col;\n    ctx.fillRect(x, y, w * (v / (max || 1)), h);",
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
    from: '    if (!this.isPlayer && !this.down) this.drawSideRing(ctx);',
    to:   '    /* no ring */',
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
    file: F('basescreen.js'),
    from: "        Renderer.drawPips(ctx, bx, by, bw, 7, h.hp, h.max, h.col);",
    to:   "        ctx.fillStyle = '#0a1018'; ctx.fillRect(bx, by, bw, 7);\n        ctx.fillStyle = h.col; ctx.fillRect(bx, by, Math.round(bw * h.pct), 7);",
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
    from: "'MEMORIAL', 'WANTED', 'GATE'];",
    to:   "'MEMORIAL', 'WANTED'];",
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
    from: "const MENU_ITEMS = ['ENTER BASE','OPTIONS'];",
    to:   "const MENU_ITEMS = ['ENTER BASE','CONTINUE','OPTIONS'];",
  },
  {
    name: '#continue the base does not offer it',
    file: F('basescreen.js'),
    from: "      _btn(ctx, W - 60 - 190, y + 4, 190, 30, 'CONTINUE',",
    to:   "      if (false) _btn(ctx, W - 60 - 190, y + 4, 190, 30, 'CONTINUE',",
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
    from: "      ctx.fillText(`He3 ${ore}`, resX + 248, 28);",
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
    from: "      drawStatIcon(ctx, 'ore', resX + 232, 18, 11, oreCol);",
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
    from: "        ctx.fillText(`${reg.label} · CONTRACTS — more moons open with the Moon Gate`,",
    to:   "        ctx.fillText(`CONTRACTS`,",
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
    from: "'MEMORIAL', 'WANTED', 'GATE'];",
    to:   "'MEMORIAL', 'GATE'];",
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
    from: "      ctx.fillText(`${Math.round(w.bounty / 2)} CC for the body`, px + pw - 34, y + 46);",
    to:   "      void 0;",
  },
  {
    name: '#64 the board hides whether he has been sighted',
    file: F('basescreen.js'),
    from: "      const seen = w.state === 'sighted'\n        ? (where ? `last seen: ${where}` : 'sighted')\n        : 'no sighting yet';",
    to:   "      const seen = 'no sighting yet';",
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
    from: "    const layoutKey = groundKey ?? ((difficulty === 'hard' || _wantedHere)",
    to:   "    const layoutKey = groundKey ?? ((difficulty === 'hard')",
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
    from: "                     56 + _contractW + 14, y + 22);",
    to:   "                     60, y + 18);",
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
    from: "      ctx.fillText(job, px + 34 + ctx.measureText(`${corp.label || w.race} · level ${w.level}`).width + 12,\n                   y + 42);",
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
    from: "        { label: `Accept, then open fire (${robbery} karma)`,\n          result: { combat: difficulty, ambush: true, karma: robbery } },",
    to:   "",
  },
  {
    name: '#70 treachery is free',
    file: F('game.js'),
    from: "          result: { combat: difficulty, ambush: true, karma: robbery } },",
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
    from: "    _drawRunGoals(ctx, resX, barUp ? CMD_BAR.y + CMD_BAR.h + 4 : RUN_GOALS_BOX.y);",
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
    from: "        _wrap(ctx, closed, x + 12, my + 42, CARDW - 24, 13, 3);",
    to:   "        void 0;",
  },
  {
    name: '#73 the reason is cut off where the card ends',
    file: F('basescreen.js'),
    from: "        _wrap(ctx, closed, x + 12, my + 42, CARDW - 24, 13, 3);",
    to:   "        ctx.fillText(_clip(ctx, closed, CARDW - 24), x + 12, my + 42);",
  },
  {
    name: '#71 a shut contract is still clickable',
    file: F('basescreen.js'),
    from: "      if (!closed) _zones.push({ x, y: my, w: CARDW, h: 88, act: 'mission', arg: m.id });",
    to:   "      _zones.push({ x, y: my, w: CARDW, h: 88, act: 'mission', arg: m.id });",
  },
  {
    name: '#71 the blurb runs over the line below it again',
    file: F('basescreen.js'),
    from: "      _wrap(ctx, m.blurb, x + 12, my + 38, CARDW - 24, 13, 2);",
    to:   "      _wrap(ctx, m.blurb, x + 12, my + 38, CARDW - 24, 13);",
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
    from: "  VENT_H:    2 * TILE,   // the duct: the module's top rows of tiles",
    to:   "  VENT_H:    0,          // the duct: the module's top rows of tiles",
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
    from: "  return HULL_GRID.VENT_H\n       + (HULL_GRID.MODULE_H - HULL_GRID.VENT_H) * HULL_GRID.WALK_FRAC;",
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
    from: "  static get ENEMY_STATION()  { return { x: 750, y: 200 }; }",
    to:   "  static get ENEMY_STATION()  { return { x: 850, y: 200 }; }",
  },
  {
    name: '#73 the player hull is slid over the orders panel',
    file: F('ship.js'),
    from: "  static get PLAYER_STATION() { return { x: 170, y: 180 }; }",
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
    from: "  VENT_H:    2 * TILE,   // the duct: the module's top rows of tiles",
    to:   "  VENT_H:    1 * TILE,   // the duct: the module's top rows of tiles",
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
    from: "    this.carboniteTick();",
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
    from: "    if (this.isPlayer) {\n      ctx.save();\n      ctx.font = '9px Share Tech Mono, monospace';",
    to:   "    if (true) {\n      ctx.save();\n      ctx.font = '9px Share Tech Mono, monospace';",
  },
  {
    name: '#79 both sides draw their health bars on one row',
    file: F('crew.js'),
    from: "      const by = this.y + (this.isPlayer ? -19 : 6);",
    to:   "      const by = this.y - 19;",
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
    from: "      drawStatIcon(ctx, 'medical', resX + 300, 18, 11, dCol);\n      ctx.fillStyle = dCol;\n      ctx.fillText(`${doses}`, resX + 316, 28);",
    to:   "      drawStatIcon(ctx, 'medical', resX + 300, 18, 11, dCol);",
  },
  {
    name: '#80 the top bar forgets the rations',
    file: F('renderer.js'),
    from: "      drawStatIcon(ctx, 'eating', resX + 348, 18, 11, fCol);\n      ctx.fillStyle = fCol;\n      ctx.fillText(`${food}`, resX + 364, 28);",
    to:   "      drawStatIcon(ctx, 'eating', resX + 348, 18, 11, fCol);",
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
    from: '    this._drawVents(ctx);\n    this._drawDuctState(ctx);',
    to:   '    this._drawVents(ctx);',
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
    // Re-aimed in update99 (the Was drain joined the line).
    from: '    return Math.max(0, this.capacity - dmg - this.penalty - (this.drain || 0)) + this.cyborgBonus;\n  }\n\n  /** Live output',
    to:   '    return Math.max(0, this.capacity - dmg - this.penalty - (this.drain || 0));\n  }\n\n  /** Live output',
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
    from: '    const pct = Math.round(this.level * 100);\n    const top = y',
    to:   '    if (this.level >= OXYGEN.MAX * 0.95) return;\n    const pct = Math.round(this.level * 100);\n    const top = y',
  },
  {
    name: '#88 the air figure goes back to the middle',
    file: F('oxygen.js'),
    from: '    ctx.fillText(`O₂ ${pct}%`, x + w - 4, top + 11);',
    to:   '    ctx.fillText(`O₂ ${pct}%`, x + w / 2, y + h / 2 + 3);',
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
    from: '        const lift    = lit && p >= ownFree - lifts;',
    to:   '        const lift    = false;',
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
    from: '      ((mods[b]._powerStamp ?? 0) - (mods[a]._powerStamp ?? 0)) || (b - a));',
    to:   '      (b - a));',
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
  {
    name: '#90a a cloaked hull does not say so',
    file: F('ship.js'),
    from: '      ctx.fillText(left > 0 ? `CLOAKED ${left}s` : \'CLOAKED\', b.x + b.w / 2, b.y - 16);',
    to:   '',
  },
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
    from: '    if (this._busyT > 0 && this._busyAct === \'eat\') {\n      if (this._waypoints.length',
    to:   '    if (false) {\n      if (this._waypoints.length',
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
    from: '    return !!e && e.workingLevels >= 1 && e.effectivePower() >= 1;',
    to:   '    return !!e && e.workingLevels >= 1;',
  },
  {
    name: '#91 gravity ignores the engines\' damage',
    file: F('ship.js'),
    from: '    return !!e && e.workingLevels >= 1 && e.effectivePower() >= 1;',
    to:   '    return !!e && e.power >= 1;',
  },
  {
    name: '#91 a ship with no engines has gravity',
    file: F('ship.js'),
    from: '    return !!e && e.workingLevels >= 1 && e.effectivePower() >= 1;',
    to:   '    return !e || (e.workingLevels >= 1 && e.effectivePower() >= 1);',
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
    from: '      if (sys.type === \'engines\' && sys === ship.getSystem(\'engines\')) {',
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
    from: "      if (!this.isPlayer && c.isPrisoner && typeof UI !== 'undefined') {",
    to:   "      if (false) {",
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
    from: "    const floor = (x) => x.type === 'engines' || x.type === 'oxygen' ? 1",
    to:   "    const floor = (x) => x.type === 'oxygen' ? 1",
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
    from: "    STATE = 'map';\n    _mapView = 'ship';\n  }",
    to:   "    STATE = 'map';\n  }",
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
    from: "      const dmgN  = r.sys ? Math.min(capBase, r.sys.damagedLevels) : 0;",
    to:   "      const dmgN  = r.sys ? Math.max(0, Math.min(capBase, r.sys.damagedLevels) - (r.cyborgBonus ?? 0)) : 0;",
  },
  {
    name: "#93a the nebula is drawn as damage",
    file: F("renderer.js"),
    from: "        ctx.fillStyle = damaged ? '#cc2233' : nebula ? '#8a3fbf'",
    to:   "        ctx.fillStyle = damaged ? '#cc2233' : nebula ? '#cc2233'",
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
    from: "      if (c.air <= 0) c.takeDamage(SALVAGE.VOID_DPS * dt, 'the void');",
    to:   "      c.takeDamage(SALVAGE.VOID_DPS * dt, 'the void');",
  },
  {
    name: "#93b a dry suit costs nothing",
    file: F("game.js"),
    from: "      if (c.air <= 0) c.takeDamage(SALVAGE.VOID_DPS * dt, 'the void');",
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
    from: "      _recoverBoarders({ aboardLost: 'went down with the enemy ship' });\n    }",
    to:   "      _recoverBoarders();\n    }",
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
    from: "    return this._loadHeatRate() + this.cargoHeatRate();",
    to:   "    return this._loadHeatRate();",
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
    from: "      if (!through) Particles.floatText(proj.x, proj.y - 6, 'ARMOUR', '#c8d8f0', 11);\n",
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
    name: "#96 the Sergeant wears two chevrons, like a Corporal",
    file: F("renderer.js"),
    from: "    L[6]  = stack(3, 1.4, 2.4);                                    // Sergeant",
    to:   "    L[6]  = stack(2, 1.4, 2.4);                                    // Sergeant",
  },
  {
    name: "#96 a Lieutenant looks like a Second Lieutenant",
    file: F("renderer.js"),
    from: "    L[13] = [['rect', 5, 3, 10, 4, true]];                         // Lieutenant",
    to:   "    L[13] = [['rect', 5, 3, 10, 4, false]];                        // Lieutenant",
  },
  {
    name: "#96 warrant officers in the enlisted steel",
    file: F("renderer.js"),
    from: "    { from: 9,  to: 11, key: 'warrant',  col: '#4dd8c0' },",
    to:   "    { from: 9,  to: 11, key: 'warrant',  col: '#c8d0dc' },",
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
    file: F("basescreen.js"),
    from: "      markX += Renderer.drawRankInsignia(ctx, _lvl, markX, y + 13, 10) + 5;",
    to:   "      markX += 5;",
  },
  {
    name: "#96 the barracks card loses the specialisations",
    file: F("basescreen.js"),
    from: "      const _sw = Renderer.drawSpecialties(ctx, c, markX, y + 13, 10, 2);",
    to:   "      const _sw = 0;",
  },
  {
    name: "#96 the mess card loses the insignia",
    file: F("basescreen.js"),
    from: "      Renderer.drawRankInsignia(ctx, (typeof rankLevelOf !== 'undefined') ? rankLevelOf(c) : 0,\n        rx + 46",
    to:   "      (() => 0)(ctx, (typeof rankLevelOf !== 'undefined') ? rankLevelOf(c) : 0,\n        rx + 46",
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
  {
    name: "#98 the commander bar hangs over the map too",
    file: F("renderer.js"),
    from: "    return !!state.enemyShip && typeof Commander !== 'undefined'",
    to:   "    return typeof Commander !== 'undefined'",
  },
  {
    name: "#98 the objective line stays under the bar in a fight",
    file: F("renderer.js"),
    from: "barUp ? CMD_BAR.y + CMD_BAR.h + 4 : RUN_GOALS_BOX.y",
    to:   "RUN_GOALS_BOX.y",
  },
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
    from: "    // `drain` — the Was sceptre's −N for 10 s (update99), like a nebula.\n    return Math.max(0, this.capacity - dmg - this.penalty - (this.drain || 0)) + this.cyborgBonus;\n  }\n\n  /** Live output",
    to:   "    return Math.max(0, this.capacity - dmg - this.penalty) + this.cyborgBonus;\n  }\n\n  /** Live output",
  },
  {
    name: "#99 the old chips stay in the catalogue",
    file: F("cargo.js"),
    from: "const TABLET_VALUE = [60, 120, 240, 480];",
    to:   "const TABLET_VALUE = [60, 120, 240, 480];\nCARGO_ITEMS.chip_mobility_1 = { label: 'Mobility I', short: 'CHIP', w: 1, h: 1, col: '#b8c4d4', kind: 'chip', value: 40 };",
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
