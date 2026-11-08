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
  /* THE DRIVE DRINKS WHILE IT RUNS (update203, jj: "paliwo cały czas się
     zużywa, zależnie od levelu włączonego silnika; skok kosztuje swoje, jak
     było; poza stacją i bazą"): He2 a second for every powered level of
     the engines — 0,4 L/s on three bars, a FULL BURN twice that. */
  BURN_HE2:      0.004,
  BURN_FULL:     2,
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

  /** He2 the running drive burns a second (update203): every powered level of
   *  the engines, twice on a FULL BURN; nothing moored, on the ground, a wreck. */
  function burnRate(ship) {
    if (!ship || ship.isDerelict || ship.isPreview || ship.isMoored?.() || ship.layout?.grounded || ship.layout?.immobile) return 0;
    const eng = host(ship, 'he2');
    if (!eng || eng.isDisabled?.()) return 0;
    const p = Math.max(0, eng.effectivePower?.() ?? eng.power ?? 0);
    return p * TANKS.BURN_HE2 * (ship.fullBurn ? TANKS.BURN_FULL : 1);
  }
  /** Is her drive dry (update203)? A tank she has, and nothing in it: the engines die. */
  function dry(ship) { return capacity(ship, 'he2') > 0 && amount(ship, 'he2') <= 1e-9; }

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
    if (ship.isDerelict) return [];          // a wreck's tanks bled out long ago (update193)
    ensure(ship);
    /* the drive's own thirst (update203) */
    const burn = burnRate(ship);
    if (burn > 0 && amount(ship, 'he2') > 0) {
      take(ship, 'he2', burn * dt);
      if (dry(ship) && ship.isPlayer && typeof UI !== 'undefined' && !ship._drySaid) {
        ship._drySaid = true;
        UI.notify('The He2 tank is dry — the engines die. No evasion, no speed, no jump.', 'alert');
      }
    }
    if (!dry(ship)) ship._drySaid = false;
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

  /* ── THE PICTURES (update194, jj: "zbiorniki zrób na styl zbiorników
   * małych, jak ciecz, nie pipsach — osobny przypadek, aby ludzie
   * odróżniali gazy; wskazówka pokazująca ile jest, jak w samochodach") ──
   * Two different things, drawn as two different things:
   *   He2 is a LIQUID — a sight glass: the fuel stands in it, its surface
   *     rocks, bubbles rise; amber under a quarter.
   *   AIR is a GAS — a bottle with a pressure DIAL: a needle over a scale,
   *     the red at the bottom of it.
   * `drawSight` and `drawDial` draw them anywhere; `drawOnModule` stands
   * them in the module, the panel puts them on the console. */
  const LIQ = { top: '#ff9aa6', mid: '#ff5a6e', deep: '#a8233a' };

  /** A sight glass of liquid He2: `f` 0..1 full, `t` the clock. */
  function drawSight(ctx, x, y, w, h, f, t = 0, o = {}) {
    const low = f < TANKS.LOW, leak = !!o.leak;
    ctx.save();
    ctx.fillStyle = '#10161f'; ctx.fillRect(x, y, w, h);                                 // the glass, dark
    const lvl = y + h - 2 - (h - 4) * Math.max(0, Math.min(1, f));
    if (f > 0) {
      const g = ctx.createLinearGradient(0, lvl, 0, y + h);
      g.addColorStop(0, low ? '#ffd27a' : LIQ.top); g.addColorStop(0.4, low ? '#ffb020' : LIQ.mid); g.addColorStop(1, low ? '#8a5a10' : LIQ.deep);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x + 1, y + h - 1);
      const amp = Math.min(1.6, (h - 4) * 0.06) * (o.still ? 0 : 1);
      for (let k = 0; k <= w - 2; k += 1) ctx.lineTo(x + 1 + k, lvl + Math.sin(t * 3 + k * 0.7) * amp);
      ctx.lineTo(x + w - 1, y + h - 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,240,0.45)'; ctx.fillRect(x + 1, Math.round(lvl), w - 2, 1);        // the meniscus
      for (let b = 0; b < 3; b++) {                                                         // bubbles rising
        const ph = (t * 0.6 + b * 0.37) % 1, by = y + h - 2 - ph * (y + h - 2 - lvl);
        if (by > lvl + 1) { ctx.fillStyle = 'rgba(255,220,225,0.55)'; ctx.fillRect(x + 2 + ((b * 5) % Math.max(1, w - 4)), by, 1, 1); }
      }
    }
    // graduation marks, the glint of the glass, the frame
    ctx.fillStyle = 'rgba(200,215,235,0.35)';
    for (let k = 1; k < 4; k++) ctx.fillRect(x + w - 3, y + 2 + (h - 4) * k / 4, 2, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 1, y + 1, 1, h - 2);
    ctx.strokeStyle = leak ? '#ff3a4a' : '#6a7a90'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  /** A pressure dial for the air: `f` 0..1, radius `r`, centre (cx, cy). */
  function drawDial(ctx, cx, cy, r, f, o = {}) {
    const low = f < TANKS.LOW, leak = !!o.leak, A0 = Math.PI * 0.8, A1 = Math.PI * 2.2;
    ctx.save();
    ctx.fillStyle = '#e8edf4'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();      // the face
    ctx.strokeStyle = '#3a4456'; ctx.lineWidth = Math.max(1, r * 0.18); ctx.stroke();                // the bezel
    // the red at the bottom of the scale, then the ticks
    ctx.strokeStyle = '#e0303e'; ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, A0, A0 + (A1 - A0) * TANKS.LOW); ctx.stroke();
    ctx.strokeStyle = '#2a3242'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const a = A0 + (A1 - A0) * k / 4;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62); ctx.lineTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86); ctx.stroke();
    }
    // the needle — it trembles a little when the bottle leaks
    const jit = leak ? Math.sin((typeof performance !== 'undefined' ? performance.now() : 0) * 0.04) * 0.08 : 0;
    const a = A0 + (A1 - A0) * Math.max(0, Math.min(1, f)) + jit;
    ctx.strokeStyle = low ? '#e0303e' : '#14181f'; ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); ctx.stroke();
    ctx.fillStyle = '#14181f'; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, r * 0.14), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return a;
  }

  /** The level in a room's painted sight glass (update219): the glass darkened, the liquid up to `f` — air
   *  light blue, He2 its pink (amber when low) — a meniscus, a few bubbles; red edges while it leaks. */
  function drawGlass(ctx, x, y, w, h, f, t, kind, leak) {
    const low = f < TANKS.LOW;
    const C = kind === 'air' ? (low ? ['#ffd27a', '#ffb020', '#8a5a10'] : ['#c8f4ff', '#3fd8ff', '#0a6a8a'])
                             : (low ? ['#ffd27a', '#ffb020', '#8a5a10'] : [LIQ.top, LIQ.mid, LIQ.deep]);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = 'rgba(8,14,22,0.92)'; ctx.fillRect(x, y, w, h);                      // the painted liquid, put out
    const lvl = y + h - h * Math.max(0, Math.min(1, f));
    if (f > 0) {
      const g = ctx.createLinearGradient(0, lvl, 0, y + h);
      g.addColorStop(0, C[0]); g.addColorStop(0.35, C[1]); g.addColorStop(1, C[2]);
      ctx.fillStyle = g; ctx.fillRect(x, lvl, w, y + h - lvl);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x, lvl, w, Math.min(0.6, h * 0.05));   // the meniscus
      for (let b = 0; b < 2; b++) {                                                                 // bubbles rising
        const ph = (t * 0.6 + b * 0.5) % 1, by = y + h - ph * (y + h - lvl);
        if (by > lvl + 0.6) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x + w * (0.3 + 0.35 * b), by, 0.5, 0.5); }
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(x, y, Math.max(0.4, w * 0.2), h);         // the glint
    ctx.restore();
    if (leak) { ctx.save(); ctx.strokeStyle = '#ff3a4a'; ctx.lineWidth = 0.6; ctx.strokeRect(x - 0.3, y - 0.3, w + 0.6, h + 0.6); ctx.restore(); }
  }

  /** The tank in her module: He2 a glass of fuel on its stand; air a bottle with its dial. */
  function drawOnModule(ctx, ship, kind, t = 0) {
    const sys = host(ship, kind), room = sys ? ship.getRoomById?.(sys.roomId) : null;
    if (!room || capacity(ship, kind) <= 0) return null;
    const fh = room.floorH ?? room.h, top = room.floorTop ?? room.y;
    const f = frac(ship, kind), leak = leakRate(ship, kind) > 0;
    /* THE ROOM'S OWN SIGHT GLASS (update219, jj: "w o2 i engine module jest trochę inaczej wskaźniki powietrza i
       wodoru, dopasuj to"): the drawn rooms have the tank painted in — the air bottle by the fan, the He2 tube
       over the drive — so the level goes INTO its glass, and nothing of ours stands next to it */
    const G = typeof moduleSpots === 'function' ? moduleSpots(sys.type, sys.yard ?? null)?.glass : null;
    if (G) {
      const kx = room.w / 100, ky = fh / 50;
      const gx = room.x + G.x * kx, gy = top + G.y * ky, gw = G.w * kx, gh = G.h * ky;
      drawGlass(ctx, gx, gy, gw, gh, f, t, kind, leak);
      return { x: gx, y: gy, w: gw, h: gh, glass: true };
    }
    const w = kind === 'air' ? 14 : 12, h = Math.min(40, fh - 12), x = room.x + room.w - w - 5, y = top + fh - h - 5;
    ctx.save();
    if (kind === 'he2') {
      // a fuel tank: a steel jacket with a long window down its face
      ctx.fillStyle = '#2a3242'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#3a4456'; ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y + h - 3, w, 3);
      ctx.fillStyle = '#5a6a80'; ctx.fillRect(x + w / 2 - 2, y - 3, 4, 3);                    // the filler cap
      drawSight(ctx, x + 3, y + 4, w - 6, h - 9, f, t, { leak });
    } else {
      // a gas bottle: rounded shoulder, a valve, the dial on its neck
      ctx.fillStyle = '#3a6a8a';
      ctx.fillRect(x, y + 9, w, h - 9);
      ctx.beginPath(); ctx.arc(x + w / 2, y + 9, w / 2, Math.PI, 0); ctx.fill();          // the rounded shoulder
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 2, y + 9, 2, h - 11);
      ctx.fillStyle = '#c8d4e2'; ctx.fillRect(x + 1, y + h - 9, w - 2, 3);                    // the band: AIR
      ctx.fillStyle = '#5a6a80'; ctx.fillRect(x + w / 2 - 2, y, 4, 4);                        // the valve
      drawDial(ctx, x + w / 2, y + 15, Math.min(6, w / 2 - 1), f, { leak });
    }
    if (leak) {                                                                                 // a drip or a hiss
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

  return { capacity, ensure, amount, frac, pips, litres, capLitres, take, add, space, jumpAir, leakRate, burnRate, dry, update,
           pourHold, inHold, drawOnModule, drawSight, drawDial, drawGlass, serialise, restore, HOST };
})();

if (typeof window !== 'undefined') { window.Tanks = Tanks; window.TANKS = TANKS; }
