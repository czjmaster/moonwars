/* ============================================================
   MOON WARS — chase.js  (update188)

   THE FIGHT IS A CHASE.

   jj 31.10: "zamienić walkę trochę tak jak w menu jest — statek ściga
   statek. Jeżeli prędkość nasza jest większa niż przeciwnika, trochę się
   zbliżamy; jeżeli przeciwnika szybsza, to się oddala. Za ekranem zaczynamy
   tracić widoczność na moduły; jak ostatni moduł zniknie przeciwnika z
   ekranu, to przeciwnik uciekł. Na panelu energii info o prędkości.
   Księżyc na dole porusza się proporcjonalnie do prędkości, gwiazdy też,
   wolniej. Walki z bunkrami wymagają 0 prędkości." · 23:54: prędkość —
   "tak, ale uwzględnij ilość silników".

   SPEED (`speed`), for each hull, from what she has right now:
     · her ENGINES' working, powered levels (effectivePower) — no power,
       no thrust: 0;
     · how MANY drives she has (the stern nozzles of her hull picture,
       `hullArtGeometry().engines`) — each beyond the first +20%;
     · somebody at the HELM — without a pilot she flies at 70%;
     · her SIZE — every room is mass: −4% a room.
   THE GAP (`CombatManager.chase.gap`, px): the enemy hull slides along x by
   (their speed − ours) × PX_PER_SPEED a second, never closer than MIN_GAP to
   where the fight put her. When the last of her rooms is past the right
   edge of the screen, she has got away — the same ENEMY_FLED as a jump.

   NOT A CHASE: a target on the ground (bunker, mech), a wreck, the boss's
   station, and customs (they hold you in a beam). Everything stands still:
   speed 0, the ground does not slide (the engines still burn).
   ============================================================ */

'use strict';

const CHASE = {
  BASE:          10,     // speed of a hull with one level of drive…
  PER_POWER:     9,      // …and this much for every working, powered level
  PER_ENGINE:    0.2,    // each drive beyond the first
  NO_PILOT:      0.7,    // nobody at the helm
  MASS_PER_ROOM: 0.04,   // each room a little slower
  PX_PER_SPEED:  0.6,    // gap, px a second, per point of speed between them (update194: was 1.6 — "za szybko")
  BURN:          1.8,    // a FULL BURN (update194): their drive flat out after the spool
  MIN_GAP:       -60,    // px: never closer than this to where she started
  REF_SPEED:     40,     // the ground slides at its old pace at this speed
  STAR_FACTOR:   0.35,   // the stars, slower than the ground
};

const Chase = (() => {

  /** Is this fight a chase? null when it is, else why not. */
  function refusal(player, enemy) {
    if (!player || !enemy) return 'no fight';
    if (enemy.layout?.grounded) return 'a target on the ground';
    if (enemy.isDerelict) return 'a wreck';
    if (enemy.layout?.customs) return 'customs hold you';
    if (enemy.layout?.isStation || enemy.isBoss) return 'a station';
    return null;
  }

  /** How many drives she has: the stern nozzles of her picture, 1 at least. */
  function engineCount(ship) {
    let n = 1;
    try { n = ship?.hullArtGeometry?.()?.engines?.length ?? 1; } catch (e) { n = 1; }
    return Utils.clamp(n || 1, 1, 4);
  }

  /** Her speed right now (0 when she cannot move, or when this is no chase). */
  function speed(ship, still = false) {
    if (!ship || still || ship.layout?.grounded || ship.destroyed || (ship.hull ?? 1) <= 0) return 0;
    if (typeof Tanks !== 'undefined' && Tanks.dry?.(ship)) return 0;     // a dry drive does not push (update203)
    const eng = ship.getSystem?.('engines');
    const p = eng && !eng.isDisabled?.() ? (eng.effectivePower?.() ?? eng.power ?? 0) : 0;
    if (p <= 0) return 0;
    const n = engineCount(ship);
    const pil = ship.getSystem?.('piloting');
    const helm = pil && !pil.isDisabled?.() && ship.consoleOperator ? ship.consoleOperator(pil.roomId) : null;
    const flown = helm && helm.isPlayer === ship.isPlayer && !helm.isPrisoner ? 1 : CHASE.NO_PILOT;
    const mass = 1 / (1 + (ship.rooms?.length ?? 0) * CHASE.MASS_PER_ROOM);
    const burn = ship.fullBurn ? CHASE.BURN : 1;
    return (CHASE.BASE + CHASE.PER_POWER * p) * (1 + CHASE.PER_ENGINE * (n - 1)) * flown * mass * burn;
  }

  /** The rooms of hers still on the screen. */
  function visibleRooms(ship, W) {
    return (ship?.rooms ?? []).filter(r => r.x < W);
  }

  /**
   * One step. Moves the enemy hull by the gap's change, keeps the speeds for
   * the panel and the background, and says when she is gone.
   * `st` — CombatManager.chase: { gap, vPlayer, vEnemy, on, why }.
   * Returns 'escaped' when her last room has left the screen, else null.
   */
  function step(st, player, enemy, dt, W) {
    const why = refusal(player, enemy);
    st.on = !why; st.why = why;
    st.vPlayer = api.speed(player, !!why);     // through the module, so a test can set the speeds
    st.vEnemy  = api.speed(enemy, !!why);
    if (why || enemy.destroyed || enemy.doomed) return null;
    const want = (st.vEnemy - st.vPlayer) * CHASE.PX_PER_SPEED * dt;
    const gap = Math.max(CHASE.MIN_GAP, (st.gap ?? 0) + want);
    const dx = gap - (st.gap ?? 0);
    st.gap = gap;
    if (dx) enemy.shiftX(dx);
    if (!visibleRooms(enemy, W).length) return 'escaped';
    return null;
  }

  const api = { refusal, speed, engineCount, step, visibleRooms };
  return api;
})();

if (typeof window !== 'undefined') { window.Chase = Chase; window.CHASE = CHASE; }
