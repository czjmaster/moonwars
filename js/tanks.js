/* ============================================================
   MOON WARS — tanks.js  (update191)

   THE TANKS: AIR BY THE O₂ MODULE, He2 BY THE ENGINES.

   jj 31.10 (23:54): "zbiorniki w modułach, mała grafika z boku jak
   reaktor; pipsy pokazują ile jest powietrza i wodoru; info na panelu
   energii; tankowane tylko w bazie i w portach, zużywamy to, co mamy;
   pojemność w litrach od wielkości zbiornika; uszkodzenie modułu ze
   zbiornikiem = wyciek, większy dmg — większy wyciek; wyciek zwiększa
   szansę pożaru." · 1.11 (19:29): "zbiornik to zbiornik — musi być
   zatankowany tylko na stacjach, w bazach, albo, jak nie mamy paliwa,
   statek nam zatankuje troszkę (to, co wcześniej dostawaliśmy); jak mamy
   w inventory powietrze lub wodór, to w bazach możemy to zatankować do
   zbiorników; gracz nie może tankować podczas podróży; moduł powietrza
   i silnika ma swój tank" · He2: "tylko zbiornik, ale zdarzenia dają
   paliwo do inventory, jak było — również teraz zbiorniki O₂".

   THE RULES, AS CODE:
     · `ship.tanks = { air, he2 }`. AIR is litres; He2 is counted in He2
       (one jump burns one) and SHOWN in litres, HE2_L a unit.
     · Capacity from the module the tank hangs on: the O₂ module's level
       for the air, the engines' level for the He2. No module, no tank.
     · AIR: in a live fight the O₂ module makes air OUT OF THE TANK
       (oxygen.js); a dry tank and the module makes nothing. Every jump
       costs every mouth aboard AIR_PER_JUMP litres. Between fights (the
       map, a port) nothing is drawn — the clock is not running.
     · He2: every jump and every retreat burns it from the tank.
     · Canisters in the hold (He2 and air) are poured in ONLY in a base
       or a port (`pourHold`). Out there they are cargo.
     · A tank on a damaged module LEAKS (in a fight): litres a second by
       damaged level, and every second a chance of fire in that room.
   ============================================================ */

'use strict';

const TANKS = {
  HE2_BASE:      8,      // He2 in a tank on a level-0 drive…
  HE2_PER_LEVEL: 4,      // …and this much more a level (engines 2: 16 jumps)
  HE2_L:         10,     // litres shown for one He2
  AIR_BASE:      300,    // litres on a level-0 O₂ module…
  AIR_PER_LEVEL: 200,    // …and this much more a level (O₂ 2: 700 L)
  L_PER_O2:      2,      // litres of the tank for one unit of air the module makes
  AIR_PER_JUMP:  6,      // litres a jump, for every mouth aboard
  LEAK_AIR:      4,      // L/s, a damaged level of the O₂ module
  LEAK_HE2:      0.05,   // He2/s, a damaged level of the engines (0,5 L/s)
  FIRE_AIR:      0.012,  // chance a second, a damaged level: fire where the air leaks
  FIRE_HE2:      0.02,   // …and where the He2 does — it burns
  PIPS:          5,
  AIR_PRICE:     1,      // CC for 10 L of air at a port
  LOW:           0.25,   // under a quarter: the pips go amber, the panel warns
};

const Tanks = (() => {

  const HOST = { air: 'oxygen', he2: 'engines' };

  function host(ship, kind) { return ship?.getSystem?.(HOST[kind]) ?? null; }

  /** How much the tank on her module holds (He2 or litres); 0 with no module. */
  function capacity(ship, kind) {
    const sys = host(ship, kind);
    if (!sys) return 0;
    const lv = Math.max(0, sys.level ?? 0);
    return kind === 'air' ? TANKS.AIR_BASE + TANKS.AIR_PER_LEVEL * lv
                          : TANKS.HE2_BASE + TANKS.HE2_PER_LEVEL * lv;
  }

  /** Her tanks, made if she has none (full, or as `fill` says), kept inside capacity. */
  function ensure(ship, fill = 1) {
    if (!ship) return null;
    if (!ship.tanks) ship.tanks = { air: capacity(ship, 'air') * fill, he2: capacity(ship, 'he2') * fill };
    ['air', 'he2'].forEach(k => { ship.tanks[k] = Utils.clamp(Number(ship.tanks[k]) || 0, 0, capacity(ship, k)); });
    return ship.tanks;
  }

  function amount(ship, kind) { return ensure(ship)?.[kind] ?? 0; }
  function frac(ship, kind) { const c = capacity(ship, kind); return c > 0 ? amount(ship, kind) / c : 0; }
  function pips(ship, kind, n = TANKS.PIPS) { const f = frac(ship, kind); return f <= 0 ? 0 : Math.max(1, Math.ceil(f * n - 1e-9)); }
  function litres(ship, kind) { return kind === 'air' ? amount(ship, 'air') : amount(ship, 'he2') * TANKS.HE2_L; }
  function capLitres(ship, kind) { return kind === 'air' ? capacity(ship, 'air') : capacity(ship, 'he2') * TANKS.HE2_L; }

  /** Take up to `n` out; returns what came out. */
  function take(ship, kind, n) {
    const t = ensure(ship);
    if (!t || !(n > 0)) return 0;
    const got = Math.min(n, t[kind]);
    t[kind] -= got;
    return got;
  }

  /** Put up to `n` in; returns what went in (the rest did not fit). */
  function add(ship, kind, n) {
    const t = ensure(ship);
    if (!t || !(n > 0)) return 0;
    const put = Math.min(n, capacity(ship, kind) - t[kind]);
    t[kind] += put;
    return put;
  }

  function space(ship, kind) { return Math.max(0, capacity(ship, kind) - amount(ship, kind)); }

  /** Air a jump costs: every mouth aboard. */
  function jumpAir(ship) {
    const mouths = (ship?.crew ?? []).filter(c => c && !c.dead && !c.dying && !c.frozen && !c.isPet).length;
    return mouths * TANKS.AIR_PER_JUMP;
  }

  /** What a damaged module loses a second. */
  function leakRate(ship, kind) {
    const sys = host(ship, kind);
    const d = sys ? Math.max(0, sys.damagedLevels ?? 0) : 0;
    if (!d || amount(ship, kind) <= 0) return 0;
    return d * (kind === 'air' ? TANKS.LEAK_AIR : TANKS.LEAK_HE2);
  }

  /**
   * A fight's second: the leaks run out of a damaged module, and where
   * they run there may be fire. `rnd` for the tests. Returns the rooms lit.
   */
  function update(ship, dt, rnd = Math.random) {
    if (!ship || !(dt > 0)) return [];
    ensure(ship);
    const lit = [];
    ['air', 'he2'].forEach(kind => {
      const rate = leakRate(ship, kind);
      if (!rate) { if (ship._leakSaid) ship._leakSaid[kind] = false; return; }
      take(ship, kind, rate * dt);
      const sys = host(ship, kind), room = sys ? ship.getRoomById?.(sys.roomId) : null;
      if (ship.isPlayer && typeof UI !== 'undefined' && !(ship._leakSaid ?? {})[kind]) {
        ship._leakSaid = { ...(ship._leakSaid ?? {}), [kind]: true };
        UI.notify(kind === 'air' ? 'The air tank is leaking — repair the O₂ module!' : 'The He2 tank is leaking — repair the engines!', 'alert');
      }
      const p = (kind === 'air' ? TANKS.FIRE_AIR : TANKS.FIRE_HE2) * (sys.damagedLevels ?? 0) * dt;
      if (room && ship.fires?.start && rnd() < p) {
        const f = ship.fires.start(room.id, room.x + room.w * (0.3 + 0.4 * rnd()), room.floorTop + (room.floorH ?? room.h) * 0.7);
        if (f) lit.push(room.id);
      }
    });
    return lit;
  }

  /**
   * POUR THE HOLD IN — only in a base or a port. He2 cells and air
   * bottles out of the hold, as much as each tank takes. Returns
   * { he2, air } poured (He2, litres).
   */
  function pourHold(ship) {
    const hold = ship?.cargo, out = { he2: 0, air: 0 };
    if (!hold || !ship) return out;
    ensure(ship);
    const he2 = Math.min(Math.floor(space(ship, 'he2')), hold.countOf?.('fuel') ?? 0);
    if (he2 > 0) out.he2 = add(ship, 'he2', hold.takeStack('fuel', he2));
    const air = Math.min(Math.floor(space(ship, 'air')), hold.countOf?.('air') ?? 0);
    if (air > 0) out.air = add(ship, 'air', hold.takeStack('air', air));
    return out;
  }

  /** Canisters in the hold, waiting for a port: { he2, air }. */
  function inHold(ship) {
    const hold = ship?.cargo;
    return { he2: hold?.countOf?.('fuel') ?? 0, air: hold?.countOf?.('air') ?? 0 };
  }

  /* ── THE PICTURE ─────────────────────────────────────────────
   * A small upright cylinder against the right wall of her module, the
   * pips down its face: cyan for air, red-pink for He2, amber when low,
   * red and dripping when it leaks. */
  function drawOnModule(ctx, ship, kind, t = 0) {
    const sys = host(ship, kind), room = sys ? ship.getRoomById?.(sys.roomId) : null;
    if (!room || capacity(ship, kind) <= 0) return null;
    const fh = room.floorH ?? room.h, top = room.floorTop ?? room.y;
    const w = 12, h = Math.min(40, fh - 12), x = room.x + room.w - w - 5, y = top + fh - h - 5;
    const col = kind === 'air' ? '#8fd4ff' : '#ff6b7a';
    const f = frac(ship, kind), low = f < TANKS.LOW, leak = leakRate(ship, kind) > 0;
    ctx.save();
    ctx.fillStyle = '#1a222e'; ctx.fillRect(x, y + 3, w, h - 3);
    ctx.fillStyle = '#2c3646'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + 3, w / 2, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = leak ? '#ff3a4a' : '#5a6a80'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 3.5, w - 1, h - 4);
    ctx.fillStyle = '#5a6a80'; ctx.fillRect(x + w / 2 - 2, y - 1, 4, 3);             // the valve
    const n = TANKS.PIPS, on = pips(ship, kind), ph = (h - 10) / n;
    for (let i = 0; i < n; i++) {
      const py = y + h - 4 - (i + 1) * ph;
      ctx.fillStyle = i < on ? (low ? '#ffb020' : col) : 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 3, py + 1, w - 6, Math.max(1, ph - 2));
    }
    if (leak) {                                                                       // a drip and a hiss
      const k = (t * 2) % 1;
      ctx.fillStyle = kind === 'air' ? `rgba(200,235,255,${(1 - k).toFixed(2)})` : `rgba(255,120,130,${(1 - k).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(x - 2 - k * 6, y + h * 0.4 + k * 8, 1.6 + k * 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return { x, y, w, h };
  }

  /* ── THE SAVE ── */
  function serialise(ship) { const t = ship?.tanks; return t ? { air: Math.round(t.air * 10) / 10, he2: Math.round(t.he2 * 100) / 100 } : null; }
  function restore(ship, data) { if (ship && data) { ship.tanks = { air: Number(data.air) || 0, he2: Number(data.he2) || 0 }; ensure(ship); } }

  return { capacity, ensure, amount, frac, pips, litres, capLitres, take, add, space, jumpAir, leakRate, update,
           pourHold, inHold, drawOnModule, serialise, restore, HOST };
})();

if (typeof window !== 'undefined') { window.Tanks = Tanks; window.TANKS = TANKS; }
