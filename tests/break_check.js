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
    from: "        UI.notify(poster",
    to:   "        if (false) UI.notify(poster",
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
    name: '#64 the brig goes back to being hard to find',
    file: F('station.js'),
    from: "        ...(r() < 0.60 ? [{ type: 'brig',       cost: 80 + this.sector * 10, sold: false }] : []),",
    to:   "        ...(r() < 0.05 ? [{ type: 'brig',       cost: 80 + this.sector * 10, sold: false }] : []),",
  },

  /* ── update65 — bodies: the player decides ─────────────── */
  {
    name: '#65 an open hatch throws the dead out again, unasked',
    file: F('ship.js'),
    from: "            if (b.dead) return b.bodyOrder === 'vent';",
    to:   "            if (b.dead) return true;",
  },
  {
    name: '#65 the corpse dispatch ignores the order again',
    file: F('ship.js'),
    from: "        if (body.dead && body.bodyOrder === 'vent' && !body.carriedBy &&",
    to:   "        if (body.dead && body.decaying && !body.carriedBy &&",
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
    from: "      if (body.dead) return 'he is dead';",
    to:   "      if (false) return 'he is dead';",
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
    from: "    this.crew = this.crew.filter(c => c !== body);",
    to:   "    void 0;",
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
    from: "        Commander.shift(Commander.active(), Ship.VENT_KARMA);",
    to:   "        void 0;",
  },
  {
    name: '#65 a man who walked out on his own costs karma too',
    file: F('ship.js'),
    from: "      if (this.isPlayer && c.dead && c.bodyOrder === 'vent' &&",
    to:   "      if (this.isPlayer && c.dead &&",
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
    from: "    ctx.fillText(g.buried ? 'brought home and buried' : 'no body recovered',",
    to:   "    ctx.fillText('',",
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
    from: "    const px = Utils.clamp(x + 8, 4, _W - BODY_MENU_W - 4);\n    const py = Utils.clamp(y - h / 2, 4, _H - h - 4);",
    to:   "    const px = x + 8;\n    const py = y - h / 2;",
  },
  {
    name: '#65 the drawing keeps its own copy of the row geometry',
    file: F('renderer.js'),
    from: "      ctx.fillText(LABEL[it.act], it.x + 5, it.y + 11);",
    to:   "      ctx.fillText(LABEL[it.act], it.x + 5, it.y + 40);",
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
    from: "      it.def?.tag === 'food' && !it.damaged && this.willEat(who, it));\n    const meal = egg || ration;",
    to:   "      it.def?.tag === 'food' && !it.damaged);\n    const meal = egg || ration;",
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
    from: "    if (who._eatT > 0) return `${who.name} is already eating`;",
    to:   "    if (false) return `${who.name} is already eating`;",
  },
  {
    name: '#66 the order stops giving the menu\'s reason for FEED',
    file: F('ship.js'),
    from: "    const why = this.feedRefusal(who, item);\n    if (why) return { ok: false, message: why };",
    to:   "    const why = this.feedRefusal(who, item);\n    if (why) return { ok: false, message: 'No.' };",
  },
  {
    name: '#66 the menu offers FEED to a corpse and TREAT to the living',
    file: F('game.js'),
    from: "    return (person.dead || person.down) ? ['treat', 'vent', 'bag'] : ['feed'];",
    to:   "    return ['treat', 'vent', 'bag'];",
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
    from: "        poster = Save.reWanted(p);",
    to:   "        poster = null;",
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
    from: "      if (this.isPlayer && typeof Save !== 'undefined' && Save.reWanted) {",
    to:   "      if (typeof Save !== 'undefined' && Save.reWanted) {",
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
    from: "        if (isBody(it)) continue;",
    to:   "        if (false) continue;",
  },
  {
    name: '#68 the commander leaves the chair before the burial pays him',
    file: F('game.js'),
    from: "    if (_commander) {\n      _commander.away = false;\n      Base.saveCommander?.(_commander);\n    }\n    Commander?.setActive?.(null);\n\n    const bits = [];",
    to:   "    const bits = [];",
  },
  {
    name: '#68 the sorting screen offers your own dead for sale',
    file: F('game.js'),
    from: "    const holdHasGoods = !!hold?.items?.some(it => !isBody(it));",
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
    from: "          if (_enemyShip.weapons[slot]) _enemyShip.uninstallWeapon(slot);",
    to:   "          void 0;",
  },
  {
    name: '#68 a wanted man gets a one-bay hull he cannot arm',
    file: F('game.js'),
    from: "    const layoutKey = (difficulty === 'hard' || _wantedHere)",
    to:   "    const layoutKey = (difficulty === 'hard')",
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

/* An optional substring filter, so a single revert can be re-checked in
   seconds instead of re-running all of them: `node tests/break_check.js "#68 the menu"`.
   With no argument every revert runs, exactly as before. */
const FILTER = process.argv.slice(2).join(' ').trim();

const leaks = [];
let ran = 0;
for (const b of BREAKS) {
  if (FILTER && !b.name.includes(FILTER)) continue;
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

console.log(`\n${ran - leaks.length}/${ran} reverts caught by the tests`);
if (leaks.length) {
  console.log('\nNOT CAUGHT — these fixes have no test that fails without them:');
  leaks.forEach(l => console.log('  · ' + l));
}
process.exit(leaks.length ? 1 : 0);
