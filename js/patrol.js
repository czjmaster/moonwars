'use strict';

/* ══ THE LUNAR PATROL (update231) ═════════════════════════════════════════
 *
 * jj 12.11: „spotykamy patrol, jest dialog i prośba o wyłączenie osłon i
 * zmniejszenie ciągu silnika do 1 lev; robimy to, następnie znów połączenie i
 * mówią, że będą skanować, scan chwilę trwa, po skanie jak wszystko jest ok
 * puszczają; jeżeli mamy kontrabandę, to poproszą o wejście na pokład,
 * przeszukają kabiny, jak znajdą kontrabandę, wystawiają mandat i kontrabandę
 * zabierają. Oczywiście można próbować walczyć, ale ten przeciwnik jest mocny…
 * ten event powinien być czasem pod koniec sektora".
 *
 * The customs cruiser Maat (update171) used to turn up in place of an ordinary
 * fight, at random, and drag you in on a clock. She is the PATROL now, and she
 * TALKS. A fight against her runs through these phases:
 *
 *   approach  — she comes alongside; a moment later she calls
 *   (call)    — „shields off, drive to one" — comply, or refuse (a fight)
 *   powered   — you complied; she waits a beat, then calls again
 *   (scanCall)— „hold still, scanning"
 *   scan      — SCAN_TIME seconds of a sweep across your hull
 *   (clean)   — nothing aboard: she lets go of you
 *   (found)   — contraband: „we are coming aboard" — let them, or resist
 *   search    — INSPECTORS walk your deck and search the rooms
 *   (verdict) — what they took and the fine; she lets go of you
 *   hostile   — refused, resisted, defied, or you hurt her: the fight
 *
 * The bracketed ones are her calls: `takeHail()` hands the game the next one
 * (game.js turns it into a dialog), and the answer comes back through
 * `choose()`. While she is talking to you, you keep your shields DOWN and the
 * drive at ONE: power either back up and she warns you once, and after GRACE
 * seconds she opens fire.
 *
 * Her TRACTOR holds you through all of it — unless your engines run above what
 * it holds (SYSTEM_DEFS.tractor.holdPerLevel × its powered levels): then the
 * drive is free and you may simply jump. That is the other way out.
 *
 * Not saved (a fight is not). The meeting itself is: once a sector
 * (`run.patrolSector`).
 * ═════════════════════════════════════════════════════════════════════════ */

const PATROL = {
  on: true,            // the tests of everything else switch her off (harness), as FOE_AWAY
  /* WHERE (jj: „czasem pod koniec sektora"): a roll on every jump into one of
     the last COLS_BEFORE_EXIT columns before the exit (or the boss), once a
     sector. A hold with contraband in it draws them more often. */
  ODDS: 0.30,
  ODDS_HOT: 0.50,
  COLS_BEFORE_EXIT: 2,
  KINDS: ['combat', 'event', 'empty', 'nebula', 'asteroids'],   // what she can turn up instead of
  /* the talk */
  HAIL_DELAY: 1.2,     // s alongside before the first call
  COMPLY_DELAY: 2.5,   // s after you power down before she calls to scan
  SCAN_TIME: 10,       // s of the sweep
  GRACE: 8,            // s to power down again before she opens fire
  /* the search */
  INSPECTORS: 2,
  SEARCH_ROOMS: 3,     // rooms of the deck they come aboard on, between them
  SEARCH_TIME: 3,      // s a room
  WALK: 55,            // px/s
  /* her teeth (jj: „dobry statek… kapitan… załoga dobra, broń srebrna, gold") */
  TRACTOR_LEVEL: [2, 2, 3],          // by sector (the last for any deeper)
  SHIELD_LEVEL: 4,                   // two layers
  GUNS_EARLY: ['laser_burst', 'laser_basic'],
  GUNS_LATE: ['laser_burst', 'laser_heavy'],
  CREW: 6,
  CAPTAIN_LEVEL: 6,                  // + 2 a sector
  RARITY: ['silver', 'silver', 'gold'],
};

const Patrol = (() => {
  let S = null;                       // this fight's patrol, or null

  /* ── WHERE SHE TURNS UP ──────────────────────────────────── */

  /** Does the patrol meet us on this jump? (`rnd` for the tests.) */
  function rollAt(node, opts = {}) {
    if (!node || !PATROL.on) return false;
    const run = opts.run ?? (typeof Save !== 'undefined' ? Save.getRun() : null);
    if (!run) return false;
    const cols = opts.cols ?? (typeof SectorMap !== 'undefined' ? SectorMap.GRID.cols : 0);
    if (!cols) return false;
    const sector = run.sector ?? 1;
    if (run.patrolSector === sector) return false;                    // once a sector
    if (!PATROL.KINDS.includes(node.type) || node.wantedId) return false;
    const last = cols - 1;                                            // the exit / boss column
    if (node.col >= last || node.col < last - PATROL.COLS_BEFORE_EXIT) return false;
    const p = opts.hot ? PATROL.ODDS_HOT : PATROL.ODDS;
    return (opts.rnd ?? Math.random()) < p;
  }

  /* ── THE FIGHT ───────────────────────────────────────────── */

  function begin(combat) {
    S = { phase: 'approach', t: PATROL.HAIL_DELAY, hail: null, graceT: null, warned: false,
          scan: 0, found: false, inspectors: [], searched: 0, verdict: null, combat };
    return S;
  }
  function end() {
    if (S?.combat?.playerShip) S.combat.playerShip.inspectors = null;
    S = null;
  }
  function active() { return !!S; }
  function state() { return S; }
  function phase() { return S?.phase ?? null; }
  /** Is she still talking (not a fight, not over)? */
  function talking() { return !!S && !['hostile', 'released'].includes(S.phase); }

  /** What she asks for, met right now? */
  function complies(ship) {
    if (!ship) return false;
    const sum = t => (ship.systems ?? []).filter(s => s.type === t).reduce((a, s) => a + (s.power ?? 0), 0);
    return sum('shields') <= 0 && sum('engines') <= 1;
  }
  function checks(ship) {
    const sum = t => (ship?.systems ?? []).filter(s => s.type === t).reduce((a, s) => a + (s.power ?? 0), 0);
    return { shields: sum('shields'), engines: sum('engines') };
  }

  /** Do what she asked: every shield bay off, the drive down to one unit. */
  function powerDown(ship) {
    if (!ship) return;
    ship.systems.forEach((s, i) => {
      if (s.type === 'shields' && s.power > 0) ship.setPowerAt(i, 0);
    });
    let left = 1;
    ship.systems.forEach((s, i) => {
      if (s.type !== 'engines') return;
      const want = Math.min(left, s.power);
      if (s.power !== want) ship.setPowerAt(i, want);
      left -= want;
    });
  }

  function hostile(why) {
    if (!S || S.phase === 'hostile' || S.phase === 'released') return;
    S.phase = 'hostile'; S.hail = null; S.why = why;
    if (S.combat) S.combat.customsProvoked = true;
    if (S.combat?.playerShip) S.combat.playerShip.inspectors = null;      // the team runs home
    const msg = why === 'refused' ? '⚠ You refused the patrol. Their guns come up — break their TRACTOR, outrun it, or beat them.'
              : why === 'resisted' ? '⚠ You resisted the boarding. The patrol opens fire!'
              : why === 'defied' ? '⚠ You powered back up — the patrol opens fire!'
              : null;
    if (msg && typeof UI !== 'undefined') UI.notify(msg, 'alert');
  }

  function release() {
    if (!S) return;
    S.phase = 'released'; S.hail = null;
    if (S.combat) { S.combat.patrolRelease = true; S.combat.state = COMBAT_STATE.ENEMY_FLED; }
    if (S.combat?.playerShip) S.combat.playerShip.inspectors = null;
  }

  /** The game asks for her next call; it is handed over once. */
  function takeHail() {
    if (!S || !S.hail) return null;
    const h = S.hail; S.hail = null; S.waiting = h;
    return h;
  }

  /** The answer to her call. */
  function choose(what) {
    if (!S) return;
    S.waiting = null;
    const P = S.combat?.playerShip;
    switch (what) {
      case 'comply':  powerDown(P); S.phase = 'powered'; S.t = PATROL.COMPLY_DELAY; S.graceT = null; break;
      case 'refuse':  hostile('refused'); break;
      case 'scan':    S.phase = 'scan'; S.scan = 0; break;
      case 'clean':   release(); break;
      case 'board':   S.phase = 'search'; _board(P); break;
      case 'resist':  hostile('resisted'); break;
      case 'verdict': release(); break;
    }
  }

  /** Watch the power while she is talking: one warning, then GRACE seconds. */
  function _watch(dt, P) {
    if (complies(P)) {
      if (S.graceT != null && typeof UI !== 'undefined') UI.notify('Patrol: „Thank you, captain. Stay as you are."', 'info');
      S.graceT = null;
      return true;
    }
    if (S.graceT == null) {
      S.graceT = PATROL.GRACE;
      if (typeof UI !== 'undefined') UI.notify(`⚠ Patrol: „Shields OFF and drive at ONE — or we open fire. ${PATROL.GRACE} seconds."`, 'alert');
    }
    S.graceT -= dt;
    if (S.graceT <= 0) hostile('defied');
    return false;
  }

  /** One frame (CombatManager, while the fight is on). */
  function update(dt, combat) {
    if (!S) return;
    S.combat = combat;
    if (combat.customsProvoked && S.phase !== 'hostile' && S.phase !== 'released') { hostile('hurt'); return; }
    if (S.waiting || S.hail) return;                    // a call on the screen: nothing moves
    const P = combat.playerShip;
    switch (S.phase) {
      case 'approach':
        S.t -= dt;
        if (S.t <= 0) S.hail = 'call';
        break;
      case 'powered':
        if (!_watch(dt, P)) break;
        S.t -= dt;
        if (S.t <= 0) S.hail = 'scanCall';
        break;
      case 'scan':
        if (!_watch(dt, P)) break;
        S.scan += dt;
        if (S.scan >= PATROL.SCAN_TIME) {
          S.found = !!P?.cargo?.items?.some(it => it.def?.contraband);
          S.hail = S.found ? 'found' : 'clean';
        }
        break;
      case 'search':
        if (!_watch(dt, P)) break;
        _search(dt, P);
        break;
    }
  }

  /* ── THE INSPECTORS ──────────────────────────────────────── */

  /** Our airlock nearest to her: where the team comes in. */
  function entryOf(P, E) {
    const locks = (P?.doors ?? []).filter(d => d.isAirlock);
    const ex = E?.rooms?.length ? E.rooms.reduce((a, r) => a + r.cx, 0) / E.rooms.length : (P?.worldX ?? 0) + 2000;
    let best = null, bd = Infinity;
    locks.forEach(d => { const dd = Math.abs(d.x - ex) + Math.abs(d.y - (P.rooms[0]?.cy ?? 0)) * 0.2; if (dd < bd) { bd = dd; best = d; } });
    const room = best ? (P.getRoomById(best.roomA) ?? P.getRoomById(best.roomB)) : null;
    if (best && room) return { x: best.x + (best.x > room.cx ? -14 : 14), room };
    const r0 = P?.rooms?.[0];
    return r0 ? { x: r0.cx, room: r0 } : null;
  }

  function _board(P) {
    if (!P) return;
    const E = S.combat?.enemyShip;
    const entry = entryOf(P, E);
    if (!entry) { S.hail = 'verdict'; return; }
    /* the rooms of that deck, nearest first — the cabins they search */
    const deck = P.rooms.filter(r => r.floor === entry.room.floor && r.w > 0)
      .sort((a, b) => Math.abs(a.cx - entry.x) - Math.abs(b.cx - entry.x))
      .slice(0, PATROL.SEARCH_ROOMS);
    const y = P.floorWalkY(entry.room.floor, entry.room.cy);
    const crewOf = E?.crew?.filter(c => c && c.alive && !c.isPrisoner) ?? [];
    S.inspectors = [];
    for (let i = 0; i < PATROL.INSPECTORS; i++) {
      const c = (typeof CrewMember !== 'undefined')
        ? new CrewMember({ isPlayer: false, race: crewOf[i]?.race ?? 'terra', name: `Inspector ${['Hale', 'Ross', 'Keel'][i] ?? i + 1}` })
        : { isPlayer: false };
      c.x = entry.x + (i ? (entry.x > entry.room.cx ? -10 : 10) : 0); c.y = y;
      c.roomId = entry.room.id; c._waypoints = [];
      c.isInspector = true;
      S.inspectors.push({ c, rooms: deck.filter((r, k) => k % PATROL.INSPECTORS === i), at: null, t: 0, phase: 'walk', home: { x: entry.x, y } });
    }
    S.inspectors.forEach(m => { if (!m.rooms.length && deck.length) m.rooms = [deck[0]]; });
    P.inspectors = S.inspectors.map(m => m.c);
    if (typeof UI !== 'undefined') UI.notify('Patrol inspectors are aboard — they search your decks.', 'warn');
  }

  function _walk(c, P, tx, dt) {
    /* the doors open for them as for our own: they were invited */
    const keep = c.isPlayer; c.isPlayer = P.isPlayer;
    if (!c._waypoints?.length || Math.abs(c._waypoints[c._waypoints.length - 1].x - tx) > 1) c.moveToOnShip?.(P, tx, c.y);
    c._updateMovement?.(dt, P);
    c.isPlayer = keep;
    return Math.abs(c.x - tx) < 2;
  }

  function _search(dt, P) {
    let done = 0;
    S.inspectors.forEach(m => {
      const c = m.c;
      c.anim?.update?.(dt);
      if (m.phase === 'done') { done++; return; }
      if (m.phase === 'walk') {
        const room = m.rooms[0];
        if (!room) { m.phase = 'home'; return; }
        if (_walk(c, P, room.cx + Utils.randFloat(-0.01, 0.01), dt)) {
          m.phase = 'search'; m.t = PATROL.SEARCH_TIME; m.at = room; c.roomId = room.id;
          c._setAnim?.('repair');
        }
        return;
      }
      if (m.phase === 'search') {
        m.t -= dt;
        if (m.t <= 0) {
          S.searched++; m.rooms.shift(); m.at = null;
          c._setAnim?.('walk');
          m.phase = m.rooms.length ? 'walk' : 'home';
        }
        return;
      }
      if (m.phase === 'home' && _walk(c, P, m.home.x, dt)) { m.phase = 'done'; c._setAnim?.('idle'); }
    });
    if (done === S.inspectors.length) {
      P.inspectors = null;
      S.hail = 'verdict';
    }
  }

  /* ── WHAT IS DRAWN ───────────────────────────────────────── */

  /** The sweep over our hull while she scans, and the inspectors' torches. */
  function drawWorld(ctx, P, E) {
    if (!S || !P) return;
    const b = P.roomBounds?.();
    if (S.phase === 'scan' && b) {
      const f = Math.min(1, S.scan / PATROL.SCAN_TIME);
      const fromRight = (E?.worldX ?? 0) > P.worldX;
      const k = (S.scan * 0.9) % 1;                        // the line sweeps over and over
      const x = fromRight ? b.x + b.w - k * b.w : b.x + k * b.w;
      ctx.save();
      const g = ctx.createLinearGradient(x - 26, 0, x + 26, 0);
      g.addColorStop(0, 'rgba(95,232,255,0)'); g.addColorStop(0.5, 'rgba(95,232,255,0.28)'); g.addColorStop(1, 'rgba(95,232,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 26, b.y - 10, 52, b.h + 20);
      ctx.strokeStyle = 'rgba(180,250,255,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, b.y - 12); ctx.lineTo(x, b.y + b.h + 12); ctx.stroke();
      ctx.strokeStyle = 'rgba(95,232,255,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
      void f;
      ctx.restore();
    }
    if (S.phase === 'search') {
      S.inspectors.forEach(m => {
        if (m.phase !== 'search' || !m.at) return;
        const c = m.c, room = m.at;
        const now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
        const sw = Math.sin(now * 2.2 + c.x) * room.w * 0.35;
        ctx.save();
        ctx.fillStyle = 'rgba(255,240,170,0.18)';
        ctx.beginPath(); ctx.moveTo(c.x + 4, c.y - 14); ctx.lineTo(room.cx + sw - 10, room.floorTop + room.floorH - 2);
        ctx.lineTo(room.cx + sw + 10, room.floorTop + room.floorH - 2); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
    }
  }

  /** The banner's two lines while she talks (game.js draws the box). */
  function bannerLines(P) {
    if (!S || !talking()) return null;
    const ch = checks(P);
    const ok = (b) => b ? '✓' : '✗';
    const powerLine = `shields ${ch.shields} ${ok(ch.shields <= 0)}   ·   engines ${ch.engines} ${ok(ch.engines <= 1)}`
                    + (S.graceT != null ? `   ·   POWER DOWN: ${Math.ceil(S.graceT)} s` : '');
    switch (S.phase) {
      case 'approach': return { title: 'LUNAR PATROL — COMING ALONGSIDE', sub: 'they are hailing you…' };
      case 'powered':  return { title: 'LUNAR PATROL — HOLD POSITION', sub: powerLine };
      case 'scan':     return { title: `LUNAR PATROL — SCANNING ${Math.floor(Math.min(1, S.scan / PATROL.SCAN_TIME) * 100)}%`, sub: powerLine, bar: Math.min(1, S.scan / PATROL.SCAN_TIME) };
      case 'search':   return { title: `LUNAR PATROL — INSPECTION (${S.searched}/${S.inspectors.reduce((a, m) => a + m.rooms.length, 0) + S.searched} rooms)`, sub: powerLine };
    }
    return null;
  }

  return { rollAt, begin, end, active, state, phase, talking, complies, checks, powerDown, hostile, release,
           takeHail, choose, update, entryOf, drawWorld, bannerLines };
})();

if (typeof window !== 'undefined') { window.Patrol = Patrol; window.PATROL = PATROL; }
