/* ============================================================
   MOON WARS — crewarms.js  (update174)

   A WEAPON IN EVERY HAND.

   jj (25.10): "każdy załogant ma slot broni … laserowy nóż, pistolet
   plazmowy, karabin … stragan w porcie, zbrojownia w bazie; obrażenia
   rosną z combat — dobry żołnierz z dobrą bronią robi sieczkę".
   jj (26.10, the mock-ups mk_174_bron_walka / _rusznikarz / _koszary):
   "wygląda ciekawie, go".

   ONE REGISTER. Everything a crew sidearm is lives in CREW_ARMS below:
   its name, its colour, its crate on the grid, its price and the way
   it hurts people. The crate definitions (`arm_<key>`) are written into
   CARGO_ITEMS from here when this file loads, so a price changed in one
   place is changed on the rack, in the hold and in the fight.

   THREE KINDS OF MAN IN A BRAWL:
     a fist         — 7 + 3/lvl COMBAT, a swing every 2 s (crew.js)
     a knife        — the fist ×1.5, a swing every 1.5 s, same pairs
     a gun          — does NOT pair off: he stands at his side's edge of
                      the room and shoots, and from a standing start he
                      also shoots into the next room(s) along the deck
                      through OPEN doors (`Ship.getOpenAdjacentRooms`,
                      the same reading fire uses — an elevator shaft with
                      both doors open counts). Shut the door, no shot.
   Every hit goes through `CrewMember.strike`, so a crit (COMBAT and
   specialisation), the DOUBLE/OVERKILL/MASSACRE streak, the kill credit
   and "Got him!" are the same for a bullet as for a blow (update173).

   Charges refill by themselves (a cell, not ammunition in the hold).
   When he dies the weapon goes with him (jj's call, to confirm).
   ============================================================ */

'use strict';

const CREW_ARMS = {
  laser_knife: {
    label: 'Laser Knife', short: 'KNF', col: '#5ff3ff', kind: 'melee', cells: 1, cost: 60,
    mult: 1.5, rate: 2.0 / 1.5,
    desc: 'A plasma-edged blade. In a brawl he hits half as hard again, and faster.',
  },
  plasma_pistol: {
    label: 'Plasma Pistol', short: 'PST', col: '#c06bff', kind: 'ranged', cells: 2, cost: 120,
    dmg: 8, perLvl: 2, every: 1.6, reach: 1, ammo: 6, reload: 3, close: 1.0, life: 0.18,
    desc: 'Shoots across the room, and into the next one through an open door. Six charges, three seconds to reload.',
  },
  laser_rifle: {
    label: 'Laser Rifle', short: 'RFL', col: '#ff5566', kind: 'ranged', cells: 3, cost: 220,
    dmg: 18, perLvl: 3, every: 3.0, reach: 2, ammo: 8, reload: 4, close: 0.5, life: 0.12,
    desc: 'Two rooms down the deck through open doors. Hits hard and slowly — and badly at arm\'s length.',
  },
};

/* ── FIVE RARITIES (update178, jj 29.10: "zróbmy 5 rarity tak jak mamy —
   metal, jadeite, silver, gold, helium, oczywiście fioletowe; im lepsze
   rarity tym mocniejsze; rozmiary zostają") — the CC bars of the Lunar
   Corporation Bank. The size on the grid, the shots and the reach stay;
   the hit grows. HELIUM hits as hard as GOLD and adds its own trick
   (jj 30.10): the knife FREEZES for 3 s, the pistol SHOCKS for 3 s (the
   ion bolt's stun), the rifle has a small chance to take 100 HP in one
   shot. `weight` is the chance on a port's shelf and in a hostile hand.
   The same five will grade the ship's guns later. */
const CREW_RARITY = {
  metal:   { label: 'Metal',   mult: 1.00, cost: 1.0, col: '#9aa3ad', weight: 50 },
  jadeite: { label: 'Jadeite', mult: 1.15, cost: 1.6, col: '#3fd08a', weight: 27 },
  silver:  { label: 'Silver',  mult: 1.30, cost: 2.5, col: '#dfe8f2', weight: 14 },
  gold:    { label: 'Gold',    mult: 1.50, cost: 4.0, col: '#ffc83a', weight: 7 },
  helium:  { label: 'Helium',  mult: 1.50, cost: 7.0, col: '#b46bff', weight: 2 },
};
const RARITY_KEYS = Object.keys(CREW_RARITY);

const CrewArms = (() => {
  const KEYS = Object.keys(CREW_ARMS);
  const TUNE = {
    REFILL_IDLE: 6,      // seconds without a shot and the cell is full again
    AIM_HOLD: 0.8,       // seconds he keeps the gun up after a shot
    EDGE: 10,            // a gunman's spot: this far in from his side's wall
    HELIUM_STUN: 3,      // s — the helium knife's freeze, the helium pistol's shock
    HELIUM_REST: 2,      // s after it wears off before helium can hold him again
    HELIUM_SNIPE: 0.05,  // the helium rifle's chance of a 100 HP shot
    HELIUM_SNIPE_HP: 100,
    ENEMY_FROM: 2,       // sector the boarders start carrying them
  };

  function def(key) { return key && CREW_ARMS[key] ? CREW_ARMS[key] : null; }
  function isRanged(key) { return def(key)?.kind === 'ranged'; }
  /** A rarity key, or 'metal' for anything else (old saves, no rarity). */
  function rarityKey(r) { return CREW_RARITY[r] ? r : 'metal'; }
  function rarityDef(r) { return CREW_RARITY[rarityKey(r)]; }
  /** The crate: arm_<key> for Metal (the update174 crates), arm_<key>_<rarity> above it. */
  function crateKey(key, rar = 'metal') {
    if (!def(key)) return null;
    const r = rarityKey(rar);
    return r === 'metal' ? `arm_${key}` : `arm_${key}_${r}`;
  }
  function _splitCrate(defKey) {
    const k = String(defKey || '').startsWith('arm_') ? String(defKey).slice(4) : null;
    if (!k) return null;
    if (def(k)) return { key: k, rar: 'metal' };
    const i = k.lastIndexOf('_'), base = k.slice(0, i), r = k.slice(i + 1);
    return (i > 0 && def(base) && CREW_RARITY[r] && r !== 'metal') ? { key: base, rar: r } : null;
  }
  function keyOfCrate(defKey) { return _splitCrate(defKey)?.key ?? null; }
  function rarityOfCrate(defKey) { return _splitCrate(defKey)?.rar ?? null; }
  /** The weapon this man actually carries — a stale key is no weapon. */
  function of(man) { return (!man || man.isPet) ? null : def(man.sidearm) ? man.sidearm : null; }
  /** Its rarity: metal for no weapon, an old save, a stale key. */
  function rarityOf(man) { return of(man) ? rarityKey(man.sidearmRarity) : 'metal'; }
  /** "Gold Laser Rifle"; Metal is the plain name, as it always was. */
  function labelOf(key, rar = 'metal') {
    const d = def(key); if (!d) return '';
    const r = rarityKey(rar);
    return r === 'metal' ? d.label : `${CREW_RARITY[r].label} ${d.label}`;
  }
  /** The list price of a sidearm of that rarity. */
  function costOf(key, rar = 'metal') { const d = def(key); return d ? Math.round(d.cost * rarityDef(rar).cost) : 0; }
  /** What its helium trick is, in a few words, or ''. */
  function perkOf(key, rar) {
    if (rarityKey(rar) !== 'helium') return '';
    return key === 'laser_knife' ? 'FREEZES him for 3 s'
         : key === 'plasma_pistol' ? 'SHOCKS him for 3 s'
         : key === 'laser_rifle' ? `${Math.round(TUNE.HELIUM_SNIPE * 100)}% a shot takes ${TUNE.HELIUM_SNIPE_HP} HP` : '';
  }

  // ── the crates (one register: written into CARGO_ITEMS here) ──
  function _registerCrates() {
    if (typeof CARGO_ITEMS === 'undefined') return;
    for (const [k, d] of Object.entries(CREW_ARMS)) {
      for (const r of RARITY_KEYS) {
        const R = CREW_RARITY[r], perk = perkOf(k, r);
        CARGO_ITEMS[crateKey(k, r)] = {
          label: labelOf(k, r), short: d.short, w: d.cells, h: 1,     // the size stays (jj)
          col: r === 'metal' ? d.col : R.col,
          kind: 'sidearm', value: Math.round(costOf(k, r) / 2), arm: k, rarity: r,
          desc: `Crew sidearm${r === 'metal' ? '' : `, ${R.label.toUpperCase()} — hits ×${R.mult.toFixed(2)}`}`
              + `${perk ? `, and it ${perk}` : ''}. ${d.desc} ARM ▸ hands it to one of your people.`,
        };
      }
    }
  }
  _registerCrates();

  // ── the numbers ──────────────────────────────────────────
  function meleeMult(man) { const d = def(of(man)); return d?.kind === 'melee' ? d.mult * rarityDef(rarityOf(man)).mult : 1; }
  function swingRate(man) { const d = def(of(man)); return d?.kind === 'melee' ? d.rate : 1; }
  function ammoMax(man) { return def(of(man))?.ammo ?? 0; }
  function ammo(man) {
    const max = ammoMax(man);
    if (!max) return 0;
    if (!Number.isFinite(man._ammo)) man._ammo = max;
    return man._ammo;
  }
  function shotDamage(man, target = null) {
    const d = def(of(man));
    if (!d || d.kind !== 'ranged') return 0;
    const lvl = man.getSkillLevel ? man.getSkillLevel('combat') : 0;
    const close = target && target.roomId === man.roomId ? d.close : 1;
    return (d.dmg + d.perLvl * lvl) * close * rarityDef(rarityOf(man)).mult;
  }

  /** HELIUM'S TRICK on a man just hit (update178): the knife freezes, the
   *  pistol shocks — the ion bolt's stun, 3 s, and not again until he has
   *  had 2 s of his own (else two helium guns hold a man for ever). */
  function afterStrike(man, target, now = (typeof performance !== 'undefined' ? performance.now() / 1000 : 0)) {
    const key = of(man);
    if (!key || !target || target.dead || !target.alive || rarityOf(man) !== 'helium') return false;
    if (key === 'laser_rifle') return false;                  // the rifle's trick is in fireAt
    if (target._heliumFree != null && now < target._heliumFree) return false;
    const kind = key === 'laser_knife' ? 'freeze' : 'shock';
    // held for 3 s — not stacked on a stun he already has
    target._stunT = Math.max(target._stunT ?? 0, TUNE.HELIUM_STUN);
    target._waypoints = [];
    target._stunKind = kind;
    target._heliumFree = now + TUNE.HELIUM_STUN + TUNE.HELIUM_REST;
    if (typeof Particles !== 'undefined') Particles.floatText?.(target.x, target.y - 34, kind === 'freeze' ? 'FROZEN!' : 'SHOCK!', CREW_RARITY.helium.col, 10);
    return true;
  }

  /** Rooms his gun reaches from `roomId`: his own, then `reach` steps
   *  along the deck through open doors. A Set of room ids. */
  function reachRooms(ship, roomId, reach) {
    const out = new Set([roomId]);
    let edge = [roomId];
    for (let s = 0; s < reach && edge.length; s++) {
      const next = [];
      for (const id of edge) {
        for (const r of (ship?.getOpenAdjacentRooms?.(id) ?? [])) {
          if (!out.has(r.id)) { out.add(r.id); next.push(r.id); }
        }
      }
      edge = next;
    }
    return out;
  }

  /** Who he could shoot at right now, nearest first. */
  function targets(man, ship) {
    const d = def(of(man));
    if (!d || d.kind !== 'ranged' || !ship) return [];
    const rooms = reachRooms(ship, man.roomId, d.reach);
    return ship.crew.filter(k => k !== man && k.alive && k.inRoom !== false && !k.isPrisoner && !k.frozen &&
                                 k.isPlayer !== man.isPlayer && rooms.has(k.roomId))
      .sort((a, b) => (a.roomId === man.roomId ? 0 : 1) - (b.roomId === man.roomId ? 0 : 1)
                   || Math.abs(a.x - man.x) - Math.abs(b.x - man.x)
                   || String(a.id).localeCompare(String(b.id)));
  }
  function canHit(man, ship, target) { return targets(man, ship).includes(target); }

  // ── the clock: cooldown, reload, the cell that refills ───
  function tick(man, dt) {
    const d = def(of(man));
    if (man._shot) { man._shot.t += dt; if (man._shot.t >= man._shot.life) man._shot = null; }
    if (man._aimT > 0) man._aimT = Math.max(0, man._aimT - dt);
    if (!d || d.kind !== 'ranged') return;
    ammo(man);
    if (man._armCd > 0) man._armCd = Math.max(0, man._armCd - dt);
    if (man._reloadT > 0) {
      man._reloadT = Math.max(0, man._reloadT - dt);
      if (man._reloadT === 0) man._ammo = d.ammo;
    }
    man._idleShotT = (man._idleShotT ?? 0) + dt;
    if (man._idleShotT >= TUNE.REFILL_IDLE && man._ammo < d.ammo && !(man._reloadT > 0)) man._ammo = d.ammo;
  }

  /** One shot, if the gun is ready. Returns true when it fired. */
  function fireAt(man, ship, target) {
    const d = def(of(man));
    if (!d || d.kind !== 'ranged' || !target || target.dead) return false;
    if (man._armCd > 0 || man._reloadT > 0 || ammo(man) <= 0) return false;
    man._facing = target.x >= man.x ? 1 : -1;
    man._aimT = TUNE.AIM_HOLD;
    man._idleShotT = 0;
    man._ammo -= 1;
    man._armCd = d.every;
    if (man._ammo <= 0) man._reloadT = d.reload;
    const m = muzzle(man), hy = target.y - 12;
    man._shot = { key: man.sidearm, x0: m.x, y0: m.y, x1: target.x, y1: hy, t: 0, life: d.life };
    if (typeof Audio !== 'undefined') Audio.sfx?.sidearm?.(man.sidearm);
    /* THE HELIUM RIFLE (update178): now and then one shot takes 100 HP */
    let dmg = shotDamage(man, target);
    if (man.sidearm === 'laser_rifle' && rarityOf(man) === 'helium' && Math.random() < TUNE.HELIUM_SNIPE) {
      dmg = Math.max(dmg, TUNE.HELIUM_SNIPE_HP);
      if (typeof Particles !== 'undefined') Particles.floatText?.(target.x, target.y - 34, 'HELIUM SHOT!', CREW_RARITY.helium.col, 11);
    }
    man.strike(target, dmg);
    afterStrike(man, target);
    if (typeof Particles !== 'undefined') Particles.laserHit?.(target.x, hy);
    man.creditMeleeSwing?.();          // COMBAT XP: a shot teaches what a swing does
    return true;
  }

  /** A gunman in a room with the enemy: to his side's edge, gun up, fire. */
  function shootInRoom(man, ship, foes, dt) {
    const room = ship?.getRoomById?.(man.roomId);
    if (room) {
      const mine = ship.crew.filter(k => k.alive && k.inRoom !== false && !k.isPrisoner &&
                                         k.roomId === man.roomId && k.isPlayer === man.isPlayer && k.shooter)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const i = Math.max(0, mine.indexOf(man));
      const pad = Math.min(TUNE.EDGE + i * 8, Math.max(0, room.w / 2 - 2));
      const want = man.isPlayer ? room.x + pad : room.x + room.w - pad;
      const step = 40 * dt;
      man.x += Utils.clamp(want - man.x, -step, step);
    }
    man._setAnim?.('shoot');
    const t = targets(man, ship).find(k => foes.includes(k)) ?? foes[0];
    if (t) man._facing = t.x >= man.x ? 1 : -1;
    fireAt(man, ship, t);
  }

  /** From a standing start, nobody in his own room: across the doors. */
  function shootAcross(man, ship) {
    if (!isRanged(of(man)) || man.isPassenger || man.isPrisoner) return false;
    const t = targets(man, ship)[0];
    if (!t) return false;
    return fireAt(man, ship, t);
  }

  // ── the pictures ─────────────────────────────────────────
  const P = (g, x, y, w, h, c, a = 1) => {
    g.globalAlpha = a; g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); g.globalAlpha = 1;
  };

  /** The weapon at (hx, hy), the hand; `down` = the arm hangs. Facing right. */
  function paintHeld(g, key, hx, hy, down = false, glow = 0.3) {
    if (key === 'laser_knife') {
      if (down) {
        P(g, hx, hy - 1, 2, 2, '#3a3f4c'); P(g, hx - 1, hy + 1, 4, 1, '#8a93a6');
        P(g, hx - 1, hy + 2, 4, 6, '#5ff3ff', 0.25); P(g, hx, hy + 2, 2, 5, '#9ff8ff'); P(g, hx, hy + 2, 1, 5, '#ffffff');
        return;
      }
      P(g, hx, hy, 2, 2, '#3a3f4c'); P(g, hx + 2, hy - 1, 1, 4, '#8a93a6');
      P(g, hx + 2, hy - 1, 9, 4, '#5ff3ff', glow);
      P(g, hx + 3, hy, 7, 2, '#9ff8ff'); P(g, hx + 3, hy, 7, 1, '#ffffff');
      return;
    }
    if (key === 'plasma_pistol') {
      P(g, hx - 1, hy - 1, 7, 3, '#4a4f60'); P(g, hx - 1, hy - 1, 7, 1, '#6e7590');
      P(g, hx, hy + 2, 2, 3, '#2a2e38'); P(g, hx + 2, hy, 2, 1, '#c06bff');
      P(g, hx + 6, hy - 1, 1, 2, '#e3b6ff');
      return;
    }
    if (key === 'laser_rifle') {
      P(g, hx - 9, hy, 3, 3, '#2a2e38');
      P(g, hx - 6, hy - 1, 12, 3, '#3c4252'); P(g, hx - 6, hy - 1, 12, 1, '#5a6278');
      P(g, hx - 3, hy - 3, 5, 1, '#8a93a6'); P(g, hx - 2, hy - 2, 1, 1, '#8a93a6');
      P(g, hx - 1, hy + 2, 2, 2, '#2a2e38');
      P(g, hx - 5, hy + 2, 3, 2, '#ff5566', 0.8);
      P(g, hx + 6, hy, 6, 1, '#8a93a6'); P(g, hx + 12, hy - 1, 1, 3, '#ff5566');
    }
  }

  /** On the move: holstered at the hip, the rifle slung across his back. */
  function paintSlung(g, key, x, y) {
    if (key === 'laser_knife')   { P(g, x + 1, y - 4, 1, 4, '#5ff3ff', 0.8); P(g, x + 1, y - 5, 1, 1, '#3a3f4c'); }
    if (key === 'plasma_pistol') { P(g, x - 1, y - 5, 4, 2, '#4a4f60'); P(g, x - 1, y - 3, 2, 2, '#2a2e38'); }
    if (key === 'laser_rifle')   { for (let i = 0; i < 9; i++) P(g, x - 8 + i, y - 4 - i, 2, 1, i < 2 ? '#2a2e38' : '#3c4252'); P(g, x + 1, y - 13, 1, 1, '#ff5566'); }
  }

  /** Where the hand is, for the frame on screen. */
  function hand(man) {
    const st = man._animKey ?? man._animState, f = man.anim?.frame ?? 0;
    if (st === 'shoot' || man._aimT > 0) return { x: man.x + 8, y: man.y - 11, down: false, pose: 'aim' };
    if (st === 'fight') return f % 2 ? { x: man.x + 9, y: man.y - 11, down: false, pose: 'punch' }
                                     : { x: man.x + 1, y: man.y - 5, down: true, pose: 'down' };
    if (st === 'walk') return { x: man.x, y: man.y, down: true, pose: 'slung' };
    return null;                        // at a console, eating, facing us: not shown
  }

  /** His weapon where his hand is — mirrored the way CrewMember.draw
   *  mirrors him. Ship.draw calls it for everyone after the crew pass. */
  function drawHeld(ctx, man) {
    const key = of(man);
    if (!key || man.down || man.frozen) return;
    const h = hand(man);
    if (!h) return;
    ctx.save();
    if (man._facing === -1) { ctx.scale(-1, 1); ctx.translate(-man.x * 2, 0); }
    if (h.pose === 'slung') paintSlung(ctx, key, h.x, h.y);
    else paintHeld(ctx, key, h.x, h.y, h.down, 0.3);
    ctx.restore();
  }

  function muzzle(man) {
    const reach = man.sidearm === 'laser_rifle' ? 21 : 15;
    return { x: man.x + (man._facing < 0 ? -reach : reach), y: man.y - 11 };
  }

  /** A shot in flight. Plasma: a bolt with a tail; laser: a beam. */
  function paintShot(g, key, x0, y0, x1, y1, f) {
    if (key === 'laser_rifle') {
      g.save(); g.lineCap = 'round'; g.globalAlpha = 1 - f * 0.6;
      g.strokeStyle = 'rgba(255,85,102,0.35)'; g.lineWidth = 5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = '#ff8a95'; g.lineWidth = 2; g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 0.8; g.stroke();
      g.restore(); return;
    }
    const bx = x0 + (x1 - x0) * f, by = y0 + (y1 - y0) * f, dir = Math.sign(x1 - x0) || 1;
    g.save();
    for (let i = 0; i < 5; i++) { g.globalAlpha = 0.5 - i * 0.09; g.fillStyle = '#c06bff'; g.fillRect(bx - dir * (i * 3 + 2), by - 1, 3, 2); }
    g.globalAlpha = 1; g.fillStyle = 'rgba(192,107,255,0.4)'; g.beginPath(); g.arc(bx, by, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f0d8ff'; g.fillRect(bx - 2, by - 1, 4, 2);
    g.restore();
  }

  /** Called by CrewMember.draw after his transform: the shot, his charges. */
  function drawOver(ctx, man) {
    const s = man._shot;
    if (s) paintShot(ctx, s.key, s.x0, s.y0, s.x1, s.y1, Utils.clamp(s.t / s.life, 0, 1));
    const d = def(of(man));
    if (!d || d.kind !== 'ranged' || man.down) return;
    const n = ammo(man);
    if (n >= d.ammo && !(man._reloadT > 0)) return;      // a full cell says nothing
    const w = 3, x0 = Math.round(man.x - (d.ammo * (w + 1)) / 2), y = Math.round(man.y - 28);
    ctx.save();
    for (let i = 0; i < d.ammo; i++) {
      ctx.fillStyle = man._reloadT > 0 ? (i < d.ammo * (1 - man._reloadT / d.reload) ? '#5a6278' : '#1a2030')
                                       : i < n ? d.col : '#1a2030';
      ctx.fillRect(x0 + i * (w + 1), y, w, 2);
    }
    ctx.restore();
  }

  /** jj's drawn picture of it (update177): art/item_<key>.png, when it is
   *  on disk — the code's pixels are the floor. */
  function art(key, rar = 'metal') {
    if (typeof Assets === 'undefined' || !Assets.source) return null;
    /* its rarity's picture first (update178: item_<key>_<rarity>, from GPT),
       then the one picture jj drew of it */
    const r = rarityKey(rar);
    for (const n of r === 'metal' ? ['item_' + key + '_metal', 'item_' + key] : ['item_' + key + '_' + r, 'item_' + key]) {
      if (Assets.source(n) === 'file') return Assets.get(n) ?? null;
    }
    return null;
  }
  /** The crate's picture on any grid, centred on (cx, cy), `s` px a pixel;
   *  `box` {w, h}: the room the picture may fill (a drawn one fills it). */
  function icon(g, key, cx, cy, s = 3, box = null, rar = 'metal') {
    if (!def(key)) return;
    const img = art(key, rar);
    if (img && img.width) {
      const span = key === 'laser_rifle' ? 22 : key === 'plasma_pistol' ? 8 : 11;
      const W = box?.w ?? span * s * 1.2, H = box?.h ?? Math.max(6 * s, W * 0.6);
      const k = Math.min(W / img.width, H / img.height);
      const w = img.width * k, h = img.height * k;
      g.save(); g.imageSmoothingEnabled = true;
      g.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
      g.restore();
      return;
    }
    g.save(); g.translate(Math.round(cx), Math.round(cy)); g.scale(s, s);
    g.imageSmoothingEnabled = false;
    const off = key === 'laser_rifle' ? [-2, 0] : key === 'plasma_pistol' ? [-3, -1] : [-6, -1];
    paintHeld(g, key, off[0], off[1], false, 0.3);
    g.restore();
  }
  /** The biggest whole pixel size that fits the weapon into w × h. */
  function iconScale(key, w, h) {
    const span = key === 'laser_rifle' ? 22 : key === 'plasma_pistol' ? 8 : 11;
    return Math.max(1, Math.min(Math.floor(w / span), Math.floor(h / 6)));
  }

  // ── arming: a crate out of a grid into a man's hand ─────
  /** Put `item` (an arm_ crate in `grid`) in this man's hand. What he
   *  held goes back into the same grid; no room for it, nothing moves.
   *  Works on a live CrewMember and on a barracks record alike. */
  function armFromGrid(grid, item, man) {
    const key = keyOfCrate(item?.defKey);
    if (!key) return { ok: false, message: 'That is not a crew sidearm.' };
    if (!man || man.isPet || (typeof CORP_DEFS !== 'undefined' && CORP_DEFS[man.race]?.pet)) return { ok: false, message: 'A cat does not carry a gun.' };
    if (man.dead || man.state === 'dead') return { ok: false, message: `${man.name} is past arming.` };
    if (!grid?.items?.includes(item)) return { ok: false, message: 'It is not in the hold.' };
    if (item.damaged) return { ok: false, message: 'Too damaged to use — the broker buys scrap.' };
    const rar = rarityOfCrate(item.defKey) ?? 'metal';
    const old = def(man.sidearm) ? man.sidearm : null, oldRar = rarityKey(man.sidearmRarity);
    const home = { x: item.x, y: item.y, rot: item.rot };
    grid.remove(item);
    if (old) {
      const back = new CargoItem(crateKey(old, oldRar));
      if (!grid.autoPlace(back)) {
        grid.place(item, home.x, home.y) || grid.autoPlace(item);
        return { ok: false, message: `No room in the hold for his ${labelOf(old, oldRar)} — make room first.` };
      }
    }
    man.sidearm = key;
    man.sidearmRarity = rar;                       // update178
    // A live man starts with a full cell; a barracks record keeps no clock.
    if (typeof man.getSkillLevel === 'function') { man._ammo = CREW_ARMS[key].ammo ?? undefined; man._reloadT = 0; man._armCd = 0; }
    return { ok: true, old, message: `${man.name} carries the ${labelOf(key, rar)}${old ? ` — his ${labelOf(old, oldRar)} is in the hold` : ''}.` };
  }

  /** Take his weapon off him into `grid`. */
  function disarmToGrid(grid, man) {
    const old = def(man?.sidearm) ? man.sidearm : null;
    if (!old) return { ok: false, message: 'He carries nothing.' };
    const rar = rarityKey(man.sidearmRarity);
    const it = new CargoItem(crateKey(old, rar));
    if (!grid?.autoPlace?.(it)) return { ok: false, message: `No room for the ${labelOf(old, rar)}.` };
    man.sidearm = null;
    man.sidearmRarity = null;
    if (typeof man.getSkillLevel === 'function') man._ammo = undefined;
    return { ok: true, message: `${man.name} handed in the ${labelOf(old, rar)}.` };
  }

  // ── who sells them, who carries them ─────────────────────
  function _hash(seed, k) {
    let h = (seed >>> 0) ^ Math.imul(k + 1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  /** A port's shelf of sidearms, from its own seed (it does not move the
   *  station's dice, so nothing else about the port changes): 2–4, a
   *  fleet yard more, the rifle from sector 2. */
  /** A rarity off the weights (update178), from a number in [0, 1). */
  function rollRarity(u) {
    const total = RARITY_KEYS.reduce((a, r) => a + CREW_RARITY[r].weight, 0);
    let x = u * total;
    for (const r of RARITY_KEYS) { x -= CREW_RARITY[r].weight; if (x < 0) return r; }
    return 'metal';
  }
  function portStock(seed = 0, sector = 1, type = 'general') {
    const n = 2 + Math.floor(_hash(seed, 1) * 3) + (type === 'military' ? 1 : 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = _hash(seed, 10 + i);
      const key = r < 0.45 ? 'laser_knife' : (r < 0.8 || sector < 2) ? 'plasma_pistol' : 'laser_rifle';
      out.push({ key, rar: rollRarity(_hash(seed, 40 + i)), sold: false });
    }
    return out;
  }
  /** What a hostile hand carries: nothing in sector 1, then more and
   *  better; a boss's people are always armed. */
  function rollEnemy(sector = 1, boss = false, rnd = Math.random) {
    const s = Math.max(1, sector | 0);
    if (!boss && s < TUNE.ENEMY_FROM) return null;
    const p = boss ? 1 : Math.min(0.7, 0.2 * (s - 1));
    if (rnd() >= p) return null;
    const r = rnd();
    const rifle = boss ? 0.3 : Math.min(0.25, 0.06 * (s - 1));
    return r < rifle ? 'laser_rifle' : r < rifle + 0.4 ? 'plasma_pistol' : 'laser_knife';
  }
  /** The rarity a hostile hand carries (update178): the weights; a boss's
   *  people one step better than they rolled. */
  function rollEnemyRarity(boss = false, rnd = Math.random) {
    const r = rollRarity(rnd());
    return boss ? RARITY_KEYS[Math.min(RARITY_KEYS.length - 1, RARITY_KEYS.indexOf(r) + 1)] : r;
  }

  return {
    TUNE, KEYS, DEFS: CREW_ARMS,
    def, of, isRanged, crateKey, keyOfCrate,
    RARITY: CREW_RARITY, RARITY_KEYS, rarityKey, rarityOf, rarityOfCrate, labelOf, costOf, perkOf, rollRarity, rollEnemyRarity, afterStrike,
    meleeMult, swingRate, ammoMax, ammo, shotDamage,
    reachRooms, targets, canHit, tick, fireAt, shootInRoom, shootAcross,
    hand, drawHeld, drawOver, icon, iconScale, paintHeld, muzzle,
    armFromGrid, disarmToGrid, portStock, rollEnemy,
  };
})();

window.CrewArms = CrewArms;
window.CREW_ARMS = CREW_ARMS;
window.CREW_RARITY = CREW_RARITY;
