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
    from: "      sys.crew = sys.roomId\n        ? (sys.type === 'medbay' ? this.medbayPatients(sys.roomId)\n                                 : this.crewOperating(sys.roomId))\n        : [];",
    to:   "      sys.crew = sys.roomId ? this.crewOperating(sys.roomId) : [];",
  },
  {
    name: '#10 the station clinic turns the cat away again',
    file: F('station.js'),
    from: "      c.isPlayer && !c.isVermin && !c.isSpider &&",
    to:   "      c.isPlayer && !c.isBeast &&",
  },
  {
    name: '#14 uninstall unbolts first and loses the gun',
    file: F('base.js'),
    from: "    const pending = [...(ship.weaponCargo ?? []), w.defKey];",
    to:   "    ship.uninstallWeapon(slot);\n    const pending = [...(ship.weaponCargo ?? []), w.defKey];",
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
    from: "    const c = new CrewMember({ name: pickUniqueName(CREW_NAMES, takenNames()) });",
    to:   "    const c = new CrewMember({});",
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
    from: "      if (this.roomContested(body.roomId)) return;\n      // Already lying in a powered medbay",
    to:   "      // Already lying in a powered medbay",
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
    name: '#9 a rat in the hold counts as a boarding party',
    file: F('combat.js'),
    from: "    if (p.crew.some(c => c && c.alive && !c.isPlayer &&\n                         !c.isVermin && !c.isSpider)) return true;",
    to:   "    if (p.crew.some(c => c && c.alive && !c.isPlayer)) return true;",
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
    from: "  REFILL_PER_POWER: 0.06,",
    to:   "  REFILL_PER_POWER: 0.03,",
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
    from: "        UI.selectCrew(roster[at === -1 ? 0 : (at + 1) % roster.length]);",
    to:   "        UI.selectCrew(roster[0]);",
  },
  {
    name: '#2 TAB steps onto the dead',
    file: F('game.js'),
    from: "        .filter(c => c && c.isPlayer && c.alive && !c.isBeast);",
    to:   "        .filter(c => c && c.isPlayer && !c.isBeast);",
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
    from: "    if (!this.isPlayer && !this.down && !this.isBeast) this.drawSideRing(ctx);",
    to:   "    /* no ring */",
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
    from: "    this.maxHp = cfg.maxHp ?? (CORP_DEFS[cfg.race]?.maxHp ?? 100);",
    to:   "    this.maxHp = (CORP_DEFS[cfg.race]?.maxHp ?? cfg.maxHp ?? 100);",
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
    from: "        return `${weapon.label} is out of ammo — it needs ${need} missile`",
    to:   "        return `cannot fire`;\n        return `${weapon.label} needs ${need} missile`",
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
    from: "      const dry = (w.def.missileUse > 0) && (() => {\n        // `ship` is the hull this bar belongs to — _drawPowerBar's own\n        // argument. `state` is drawHUD's and does not reach in here.\n        const hold = ship?.cargo;\n        const have = hold ? hold.countOf('missiles') : (run?.missiles ?? 0);\n        return have < w.def.missileUse;\n      })();",
    to:   "      const dry = (w.def.missileUse > 0);",
  },

  {
    name: '#ammo an unready gun cannot be selected, in silence',
    file: F('game.js'),
    from: "        if (w && !w.armed) {\n          const why = CombatManager.fireRefusal(w);\n          if (why) UI.notify(why, 'warn');\n        }",
    to:   "        /* silent again */",
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
    from: "  fuelCost(amt = 1)       { return Math.round(amt * FUEL_PRICE          * karmaPriceFactor()); }",
    to:   "  fuelCost(amt = 1)       { return Math.round(amt * FUEL_PRICE); }",
  },
  {
    name: '#61 hull plating stops charging a bad name a surcharge',
    file: F('station.js'),
    from: "  hullRepairCost(hp = 1)  { return Math.round(hp  * REPAIR_PRICES.hull * karmaPriceFactor()); }",
    to:   "  hullRepairCost(hp = 1)  { return Math.round(hp  * REPAIR_PRICES.hull); }",
  },
  {
    name: '#61 missiles stop charging a bad name a surcharge',
    file: F('station.js'),
    from: "  missileCost(amt = 1)    { return Math.round(amt * MISSILE_PRICE       * karmaPriceFactor()); }",
    to:   "  missileCost(amt = 1)    { return Math.round(amt * MISSILE_PRICE); }",
  },
  {
    name: '#61 ore stops charging a bad name a surcharge',
    file: F('station.js'),
    from: "    return Math.round(amt * base * (1.1 + this.sector * 0.05) * karmaPriceFactor());",
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
    file: path.join(ROOT, 'js', 'ui.js'),
    from: "      _stationEl.insertBefore(banner, tabs);",
    to:   "      void banner;",
  },
  {
    name: '#61 a shut dock shows a normal empty shop instead of the reason',
    file: path.join(ROOT, 'js', 'ui.js'),
    from: "      if (refused) { tabs.remove(); document.getElementById('station-content').remove(); return; }",
    to:   "",
  },
  {
    name: '#61 the repair button multiplies its own copy of the price again',
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
    from: "    return b ? Math.max(0, b.workingLevels) : 0;",
    to:   "    return b ? 1 : 0;",
  },
  {
    name: '#63 the brig overfills instead of refusing',
    file: F('ship.js'),
    from: "    if (!rec || this.freeCells() <= 0) return false;",
    to:   "    if (!rec) return false;",
  },
  {
    name: '#63 a hull with no brig can still hold men',
    file: F('ship.js'),
    from: "  brigCapacity() {\n    const b = this.getSystem('brig');",
    to:   "  brigCapacity() {\n    return 3;\n    // eslint-disable-next-line no-unreachable\n    const b = this.getSystem('brig');",
  },
  {
    name: '#63 an unpowered brig holds them anyway',
    file: F('ship.js'),
    from: "    const held = !!brig && !brig.isDisabled();",
    to:   "    const held = true;",
  },
  {
    name: '#63 restoring power no longer resets the lock',
    file: F('ship.js'),
    from: "      this.prisoners.forEach(p => { p.escapeT = 0; p.warned = false; });\n      return;",
    to:   "      return;",
  },
  {
    name: '#63 nobody is warned before a prisoner walks',
    file: F('ship.js'),
    from: "          UI.notify(`${p.name} is working the cell door — get the brig powered!`, 'alert');",
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
    from: "        UI.notify(`${p.name} got the cell open and went out the airlock. He is gone.`, 'alert');",
    to:   "        void 0;",
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
    from: "      if (foeCap && !noQuarter && cells > 0) {",
    to:   "      if (foeCap && !noQuarter) {",
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
    from: "    if (_data.wanted.length >= WANTED_MAX) return null;",
    to:   "    if (false) return null;",
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
    from: "    const open = Save.wanted();",
    to:   "    const open = Save.wanted().concat([{ id: 'ghost', name: 'Ghost', bounty: 1, state: 'wanted' }]);",
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
    from: "      const seen = w.state === 'sighted'\n        ? (reg ? `last seen: ${reg}` : 'sighted')\n        : 'no sighting yet';",
    to:   "      const seen = 'no sighting yet';",
  },
  {
    name: '#64 the brig goes back to being hard to find',
    file: F('station.js'),
    from: "        ...(r() < 0.60 ? [{ type: 'brig',       cost: 80 + this.sector * 10, sold: false }] : []),",
    to:   "        ...(r() < 0.05 ? [{ type: 'brig',       cost: 80 + this.sector * 10, sold: false }] : []),",
  },

];

const SUITES = ['run_tests.js', 'smoke_draw.js', 'browser_test.js'];

function runSuites() {
  for (const s of SUITES) {
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
  const base = runSuites();
  if (base.failed) {
    console.log(`REFUSING TO RUN: ${base.suite} is already red on a clean tree.`);
    process.exit(2);
  }
  console.log('baseline green\n');
}

const leaks = [];
for (const b of BREAKS) {
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
    res = runSuites();
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

console.log(`\n${BREAKS.length - leaks.length}/${BREAKS.length} reverts caught by the tests`);
if (leaks.length) {
  console.log('\nNOT CAUGHT — these fixes have no test that fails without them:');
  leaks.forEach(l => console.log('  · ' + l));
}
process.exit(leaks.length ? 1 : 0);
