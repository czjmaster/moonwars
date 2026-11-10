/* ============================================================
   MOON WARS — finish.js  (update182)

   FINISH HER! — FATALITY AND MERCY, AS RECORDS IN THE CAPTAIN'S BOOK.

   jj 30.10 ("Papirus super pomysł, Pieczęć też super, pasuje wszystko"):
   when their hull falls to FINISH.HULL (5 points, update185) or lower, the screen says
   FINISH HER! — and nothing else. No hint. A captain who carries a
   working RECORD (a papyrus for a FATALITY, a seal for a MERCY — see
   RECORD_DEFS in chips.js) and has the knowledge for it, and whose
   gunners then do exactly what the recipe in the Book says, ends the
   fight on the spot:

     FATALITY — a voice, a big banner, their ship goes up. Karma −2.
                What is left is the wreck: ordinary salvage.
     MERCY    — a voice, a big banner, they strike their colours.
                Karma +2. Their CC, their gun and one of their hands
                come across (game.js `_finishMercy`).

   One record a fight, RECORD_COST knowledge a use, paid only when it
   fires. Recipes are HIDDEN: a record not on his board is a recipe he
   does not know, and the game never checks it.

   Not every fight can be finished: a wreck has nobody to finish, a
   bunker on the ground and customs are jobs, not duels, and the boss
   fights to the end (its contract pays through its own door).

   THE RULE OF THIS FILE: it WATCHES and it DECIDES. It never moves a
   hull or opens a window itself except through one door each —
   `_fatality` (their hull to zero, the ordinary victory follows) and
   `pending()` (game.js turns a MERCY into the surrender it already
   knows how to settle). Combat calls `noteHit` / `noteShot`, the crew
   calls `noteDeath`, and `update` runs inside the fight's own clock.
   ============================================================ */

'use strict';

const FINISH = {
  /* HULL POINTS, NOT A SHARE (update185, jj 31.10: "za mało energii
     zostaje, zróbmy nie %, bo mamy różne HP statków — 4-5 pipsów"). */
  HULL:    5,      // their hull points at which FINISH HER! comes up
  SALVO:   0.6,    // s: "one salvo"
  WINDOW:  2.0,    // s: "within 2 s"
  QUIET:   3.0,    // s: WHITE FLAG's held fire
  BANNER:  6.2,    // s: the big banner on screen (update193: the length of the scene and its aftermath)
  /* the call (update190 — our own words, not Mortal Kombat's „FINISH HER!”):
     her hull is down to its last points, and how she ends is the captain's */
  CALL_WORD: 'CHOOSE HER FATE!',
  CALL_SAY:  'Choose her fate!',
  CALL:    2.2,    // s: the FINISH HER! call on screen
  /* THE SCENES (update183): how long each side is played before the
     fight moves on — a FATALITY before the hull goes, a MERCY before
     their surrender comes up (game.js waits on `sceneDone`). */
  /* LONGER, AND A FILM (update193, jj 1.11: "animacja za krótka — jest i
     zaraz pojawia się następne okno; animacja powinna trwać trochę i być
     efektowna"). Time slows, the camera closes in, black bars come down;
     an ECLIPSE ends in the dark disc over the light, the flash, the
     shockwave — and only AFTER that does the victory come up. A QUARTER
     is played to its white flag before their surrender is put to us. */
  SCENE_FATAL: 5.0,
  SCENE_MERCY: 4.2,
  AFTER:       1.8,    // s after the hull goes: the shockwave, the debris — nothing else yet
  SLOW:        0.3,    // the fight's clock in the heart of an ECLIPSE…
  SLOW_MERCY:  0.55,   // …and of a QUARTER
  ZOOM:        1.14,   // how far the camera closes in on her
  BARS:        46,     // px: the black bars, top and bottom
  BASE_SCENE:  2.4,    // the length the recipes' own timings were written for (update183)
};

const Finish = (() => {

  let _f = null;          // this fight: see begin()
  let _banner = null;     // { kind, word, title, t }
  let _call = null;       // { t } — FINISH HER!
  let _pending = null;    // a MERCY waiting for game.js
  let _spoken = [];       // what the voice said (tests read it)
  let _scene = null;      // update183: { key, kind, t, ship, fired: Set, done }

  function _now() { return _f ? _f.t : 0; }

  /** A new fight. Called from CombatManager.begin. */
  function begin(enemy, opts = {}) {
    _f = {
      t: 0, hits: [], shots: [], kills: 0, used: false, on: false,
      boss: !!opts.boss, enemy: enemy ?? null,
      bad: { o2: false },       // SANCTUARY: a hit on their O₂ or medbay this fight
      wfEngines: -1, wfCockpit: -1,   // WHITE FLAG: when the engines, then the cockpit
    };
    /* the last fight's banner goes with it (update189, jj: "info fatality,
       mercy z ostatniej bitwy pojawia się w kolejnej walce na początku") —
       its clock only ran in the fight, so it waited for the next one */
    _call = null; _pending = null; _scene = null; _banner = null;
  }

  /** The fight is over. The banner stays up to the end of its time. */
  function end() { _f = null; _call = null; _scene = null; }

  /* ── CAN THIS FIGHT BE FINISHED AT ALL ─────────────────────── */
  function _ship() { return _f?.enemy ?? null; }

  /** null when it can, else why not (for the tests and the Book). */
  function fightRefusal() {
    const e = _ship();
    if (!e) return 'no fight';
    if (_f.boss) return 'the boss fights to the end';
    if (e.isDerelict) return 'nobody aboard to finish';
    if (e.layout?.grounded) return 'a target on the ground';
    if (e.layout?.customs) return 'customs — a job, not a duel';
    return null;
  }

  /** Their hull is at FINISH and the fight still runs. */
  function finishing() {
    const e = _ship();
    if (!e || fightRefusal()) return false;
    return e.hullMax > 0 && e.hull > 0 && !e.destroyed && e.hull <= FINISH.HULL;
  }

  /* ── WHAT HAPPENED (the recipes read only this) ─────────────── */

  /** One of our shots reached one of their rooms. `p` the projectile,
   *  `room` the room it landed in (Ship.receiveHit's roomHit). */
  function noteHit(p, room) {
    if (!_f || !p || !p.fromPlayer || p.fromField || !room) return null;
    const ev = { t: _now(), type: p.type, room: room.type, roomId: room.id, gun: p.gun ?? p.defKey ?? null };
    _f.hits.push(ev);
    if (_f.hits.length > 64) _f.hits.shift();
    if (room.type === 'oxygen' || room.type === 'medbay') _f.bad.o2 = true;
    if (room.type === 'engines') _f.wfEngines = ev.t;
    if (room.type === 'piloting' && _f.wfEngines >= 0 && _f.wfEngines <= ev.t) _f.wfCockpit = ev.t;
    return _check(ev);
  }

  /** One of our guns fired (WHITE FLAG's quiet starts over). */
  function noteShot() {
    if (!_f) return;
    _f.shots.push(_now());
    if (_f.shots.length > 32) _f.shots.shift();
  }

  /** One of theirs died this fight (OPEN HAND). */
  function noteDeath(victim) {
    if (!_f || !victim || victim.isPlayer || victim.isPet || victim.isPrisoner || victim.isPassenger) return;
    _f.kills++;
  }

  /* ── THE RECIPES ─────────────────────────────────────────────
   * Each one asks: did the thing that just happened (`ev`, a landed
   * hit, or null on the clock's tick) complete it? Hits from before the
   * FINISH count toward the windows; the LAST step must land at FINISH.
   */
  const _recent = (s, room) => _f.hits.filter(h => _now() - h.t <= s && (!room || h.room === room));
  const _guns = (list) => new Set(list.map(h => h.gun).filter(Boolean)).size;
  const _fires = () => {
    const e = _ship();
    const live = (e?.fires?.fires ?? []).filter(f => !f.out);
    return new Set(live.map(f => f.roomId)).size;
  };

  const RECIPES = {
    meltdown:      (ev) => !!ev && ev.room === 'reactor' && _guns(_recent(FINISH.WINDOW, 'reactor')) >= 2,
    clipped_wings: (ev) => !!ev && (ev.room === 'engines' || ev.room === 'piloting')
                          && _recent(FINISH.SALVO, 'engines').length > 0 && _recent(FINISH.SALVO, 'piloting').length > 0,
    hindenburg:    (ev) => !!ev && ev.room === 'engines' && (ev.type === 'missile' || ev.type === 'torpedo') && _fires() >= 2,
    ashes:         (ev) => !!ev && ev.room === 'weapons' && _guns(_recent(FINISH.WINDOW, 'weapons')) >= 3,
    stand_down:    (ev) => !!ev && (ev.room === 'weapons' || ev.room === 'shields')
                          && _recent(FINISH.SALVO, 'weapons').some(h => h.type === 'ion')
                          && _recent(FINISH.SALVO, 'shields').length > 0,
    white_flag:    (ev) => !ev && _f.wfCockpit >= 0 && _now() - _f.wfCockpit >= FINISH.QUIET
                          && !_f.shots.some(t => t > _f.wfCockpit),
    /* A DELIBERATE HAND (the cockpit), not any hit: an OPEN HAND that
       fired on the first shot at FINISH would take every other record's
       chance away from a captain who carries it. */
    open_hand:     (ev) => !!ev && ev.room === 'piloting' && _f.kills === 0,
    sanctuary:     (ev) => !!ev && ev.room === 'weapons' && !_f.bad.o2
                          && _f.hits.filter(h => h.room === 'weapons').length >= 3,
  };

  /* ── HIS RECORDS, AND WHETHER ONE CAN FIRE ───────────────────── */
  function _cap() { return (typeof Commander !== 'undefined') ? Commander.active() : null; }

  /** null when this record can fire now, else why not. */
  function refusal(cap, key) {
    const def = RECORD_DEFS[key];
    if (!def) return 'No such record.';
    if (!cap) return 'No commander in the chair.';
    const r = (typeof Chips !== 'undefined') ? Chips.records(cap).find(x => x.key === key) : null;
    if (!r) return `${def.label} — not in his book.`;
    if (!r.on) return `${def.label} — dark: ${r.why}.`;
    if (!_f) return `${def.label} — only at FINISH, in a fight.`;
    const no = fightRefusal();
    if (no) return `${def.label} — ${no}.`;
    if (_f.used) return `${def.label} — one record a fight.`;
    if (def.kind === 'mercy' && (_f.enemy?.crew ?? []).every(c => !c.alive || c.isPet || c.isPrisoner)) {
      return `${def.label} — nobody left aboard to strike their colours.`;
    }
    const have = Commander.knowledge(cap);
    if (have < RECORD_COST) return `${def.label} — not enough knowledge (${RECORD_COST} needed, ${Math.floor(have)} left).`;
    return null;
  }

  function _check(ev) {
    if (!_f || _f.used || !finishing()) return null;
    const cap = _cap();
    if (!cap) return null;
    const mine = Chips.records(cap).filter(r => r.on);
    for (const r of mine) {
      if (refusal(cap, r.key)) continue;
      if (RECIPES[r.key]?.(ev)) return _fire(cap, r.key);
    }
    return null;
  }

  /* ── IT FIRES ───────────────────────────────────────────────── */
  function _fire(cap, key) {
    const def = RECORD_DEFS[key];
    if (!Commander.spendKnowledge(cap, RECORD_COST)) return null;
    _f.used = true;
    _call = null;
    const kind = def.kind;
    const word = RECORD_KINDS[kind].word;
    const k = Commander.shift?.(cap, kind === 'fatality' ? -RECORD_KARMA : RECORD_KARMA);
    if (typeof Base !== 'undefined') Base.saveCommander?.(cap);
    _banner = { kind, word, title: def.label, t: 0, karma: k ? `${k.from} → ${k.to}` : null };
    _say(`${word}... ${def.label.toLowerCase()}`);
    if (typeof Audio !== 'undefined') Audio.stinger?.('massacre');
    if (typeof Camera !== 'undefined') Camera.shake?.(kind === 'fatality' ? 22 : 8, kind === 'fatality' ? 0.9 : 0.4);
    if (typeof UI !== 'undefined') (UI.logLine ?? UI.notify)(`${word}: ${def.label} — ${cap.name}, karma ${k ? `${k.from} → ${k.to}` : 'unchanged'}`, kind === 'fatality' ? 'alert' : 'good');
    if (typeof RunTally !== 'undefined') RunTally.noteCombo?.(`${word}: ${def.label}`);
    const e = _ship();
    const b = e?.roomBounds?.() ?? { x: 900, y: 200, w: 300, h: 200 };
    _scene = { key, kind, t: 0, ship: e, fired: new Set(), done: false, cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.max(b.w, b.h) / 2, killT: null, shake: 0 };
    if (e && e.hull <= 0) e.hull = 1;        // the hit that brought it is not the end of them
    /* CEASE FIRE, both ways now (update193): what is still in the air goes
       wide — a shell landing after the seal would kill the men who struck,
       and one landing in an ECLIPSE would cut the film short. */
    if (typeof CombatManager !== 'undefined') {
      (CombatManager._projectiles ?? []).forEach(p => { if (p.fromPlayer && !p.fromField && !p.hit) p.done = true; });
    }
    if (kind === 'fatality') _fatality(e);
    else {
      e && (e.struck = true);
      _pending = { key, kind };
    }
    return { key, kind };
  }

  /** DOOMED (update183): their guns fall silent, they cannot run, and
   *  the scene is played — then `_kill` takes the hull and the ordinary
   *  victory follows (combat.js). Our shots may still finish it sooner. */
  function _fatality(e) {
    if (!e) return;
    e.doomed = true;
    if (typeof CombatManager !== 'undefined') CombatManager.enemyEscapeActive = false;
  }
  function _kill(e) {
    if (!e) return;
    e.doomed = false;
    e.hull = 0;
    e.destroyed = true;
    e.fatality = true;
  }

  /** A record's scene is being played and the fight must wait for it:
   *  a FATALITY's doom, or a MERCY not yet settled. */
  function busy() { return !!_pending || !!(_scene && _scene.kind === 'fatality' && !_scene.done); }
  /** The scene has been played long enough for the fight to move on. */
  function sceneDone() {
    if (!_scene) return true;
    return _scene.t >= (_scene.kind === 'fatality' ? FINISH.SCENE_FATAL : FINISH.SCENE_MERCY);
  }

  /** A MERCY waiting to be settled: game.js takes it once. */
  function pending() { const p = _pending; _pending = null; return p; }
  function peekPending() { return _pending; }

  /* ── THE CLOCK ──────────────────────────────────────────────── */
  /* ── THE FILM (update193) ─────────────────────────────────────
   * What the game asks while a scene plays: how fast the fight's clock
   * runs, where the camera is and how close, how far the bars are down,
   * and whether the victory must still wait. */
  const _ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  function _len(s) { return s.kind === 'fatality' ? FINISH.SCENE_FATAL : FINISH.SCENE_MERCY; }
  /** 0..1..0 over the scene and its aftermath: how much of the film is on. */
  function filmK() {
    const s = _scene;
    if (!s) return 0;
    const L = _len(s), end = L + (s.kind === 'fatality' ? FINISH.AFTER : 0.6);
    if (s.t >= end) return 0;
    return Math.min(_ease(s.t / 0.5), _ease((end - s.t) / 0.7));
  }
  /** The fight's clock: slow in the heart of the scene, back to speed before the end. */
  function timeScale() {
    const s = _scene;
    if (!s || s.done) return 1;
    const L = _len(s);
    if (s.t >= L) return 1;
    const slow = s.kind === 'fatality' ? FINISH.SLOW : FINISH.SLOW_MERCY;
    const k = Math.min(_ease(s.t / 0.4), _ease((L - 0.3 - s.t) / 0.6));
    return 1 - (1 - slow) * Math.max(0, k);
  }
  /** The camera: { k (0..1), zoom, x, y (what it closes in on), bars (px), sx, sy (shake) }. */
  function cinema() {
    const s = _scene, k = filmK();
    if (!s || k <= 0) return null;
    const j = s.shake > 0 ? s.shake : 0;
    return { k, zoom: 1 + (FINISH.ZOOM - 1) * k, x: s.cx, y: s.cy, bars: FINISH.BARS * k,
             sx: j ? (Math.random() * 2 - 1) * j : 0, sy: j ? (Math.random() * 2 - 1) * j : 0 };
  }
  /** Must the victory wait? While an ECLIPSE plays and its aftermath runs. */
  function holdVictory() {
    const s = _scene;
    return !!s && s.kind === 'fatality' && (!s.done || s.t < (s.killT ?? s.t) + FINISH.AFTER);
  }

  function update(dt) {
    if (_f) {
      _f.t += dt;
      const now = finishing();
      /* THE CALL IS FOR A COMMANDER (update208, jj: "info CHOOSE HER FATE pojawia się tylko, jak
         mamy kapitana"): without one in the chair nobody can choose, so nobody shouts it;
         the rest of the window runs as before */
      if (now && !_f.on && !_f.used) {
        _f.on = true;
        if (_cap()) { _call = { t: 0 }; _say(FINISH.CALL_SAY); }
        if (typeof Audio !== 'undefined') Audio.stinger?.('overkill');
      }
      if (now && !_f.used) _check(null);      // WHITE FLAG waits on the clock
    }
    if (_scene) {
      _scene.t += dt;
      _scene.shake = Math.max(0, (_scene.shake ?? 0) - dt * 30);
      _sceneEvents(_scene);
      if (_scene.kind === 'fatality' && !_scene.done && (_scene.t >= FINISH.SCENE_FATAL || _scene.ship?.destroyed)) {
        _scene.done = true;
        _scene.killT = _scene.t;
        _scene.shake = 16;
        if (!_scene.ship?.destroyed) _kill(_scene.ship);
        if (typeof Audio !== 'undefined') Audio.sfx?.explosion?.();
      }
    }
    if (_call) { _call.t += dt; if (_call.t >= FINISH.CALL) _call = null; }
    if (_banner) { _banner.t += dt; if (_banner.t >= FINISH.BANNER) _banner = null; }
  }

  /* ── THE SCENES (update183) ──────────────────────────────────
   * Drawn in code, over their hull, each record its own. A FATALITY is
   * played while they are DOOMED (SCENE_FATAL), then the hull goes with
   * the ordinary explosion; a MERCY is played before their surrender
   * comes up (SCENE_MERCY). Nothing here moves a rule — only the eye. */
  const _rooms = (sh, type) => (sh?.rooms ?? []).filter(r => r.type === type);
  const _centre = (list, sh) => {
    if (list.length) return { x: list.reduce((a, r) => a + r.cx, 0) / list.length, y: list.reduce((a, r) => a + r.cy, 0) / list.length };
    const b = sh?.roomBounds?.() ?? { x: 900, y: 200, w: 300, h: 200 };
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };

  /** What blows up when, for each FATALITY: [{ id, at, x, y, scale }]. */
  function sceneBursts(s) {
    const sh = s?.ship;
    if (!sh || s.kind !== 'fatality') return [];
    /* the recipes were timed for 2.4 s (update183); the film is longer — every
       burst at the same SHARE of it, the last one well before the eclipse */
    const out0 = _bursts(s, sh), f = (FINISH.SCENE_FATAL - ECLIPSE_T) / FINISH.BASE_SCENE;
    return out0.map(b => ({ ...b, at: b.at * f }));
  }
  function _bursts(s, sh) {
    const R = (t) => _rooms(sh, t);
    const out = [];
    if (s.key === 'meltdown') {
      const c = _centre(R('reactor'), sh);
      [0.8, 1.4, 2.0].forEach((at, i) => out.push({ id: 'm' + i, at, x: c.x, y: c.y, scale: 0.5 + i * 0.25 }));
    } else if (s.key === 'clipped_wings') {
      const e = _centre(R('engines'), sh), p = _centre(R('piloting'), sh);
      [[0.3, e], [0.7, p], [1.1, e], [1.6, p]].forEach(([at, c], i) => out.push({ id: 'c' + i, at, x: c.x, y: c.y, scale: 0.6 }));
    } else if (s.key === 'hindenburg') {
      const e = _centre(R('engines'), sh);
      out.push({ id: 'h0', at: 0.2, x: e.x, y: e.y, scale: 0.8 });
      _fireOrder(sh).forEach((r, i, all) => out.push({ id: 'h' + r.id, at: 0.5 + 1.5 * (i / Math.max(1, all.length)), x: r.cx, y: r.cy, scale: 0.35 }));
    } else if (s.key === 'ashes') {
      const w = R('weapons');
      (w.length ? w : [{ cx: _centre([], sh).x, cy: _centre([], sh).y }])
        .forEach((r, i) => out.push({ id: 'a' + i, at: 0.4 + i * 0.45, x: r.cx, y: r.cy, scale: 0.7 }));
    }
    return out;
  }
  /** HINDENBURG burns from the engines outwards: rooms by distance. */
  function _fireOrder(sh) {
    const e = _centre(_rooms(sh, 'engines'), sh);
    return (sh?.rooms ?? []).slice().sort((a, b) => Math.hypot(a.cx - e.x, a.cy - e.y) - Math.hypot(b.cx - e.x, b.cy - e.y));
  }
  function _sceneEvents(s) {
    if (!s.ship || s.ship.destroyed || s.done) return;
    sceneBursts(s).forEach(b => {
      if (s.fired.has(b.id) || s.t < b.at) return;
      s.fired.add(b.id);
      if (typeof Particles !== 'undefined') Particles.explosion?.(b.x, b.y, b.scale);
      if (typeof Audio !== 'undefined') Audio.sfx?.explosion?.();
      s.shake = Math.max(s.shake ?? 0, 3 + b.scale * 7);          // the film's own shake (update193)
    });
  }

  /** CLIPPED WINGS: the hull lists and sinks — game.js draws it turned. */
  function hullTransform(sh) {
    const s = _scene;
    if (!s || s.key !== 'clipped_wings' || sh !== s.ship || sh?.destroyed) return null;
    const k = Math.min(1, s.t / FINISH.SCENE_FATAL);
    const b = sh.roomBounds?.() ?? { x: 0, y: 0, w: 0, h: 0 };
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, angle: 0.24 * Math.pow(k, 1.5), dy: 46 * k * k };
  }

  /* THE ECLIPSE ITSELF (update193): over the last ECLIPSE_T of the scene a
     dark disc slides across a blazing corona round her — the light goes
     out — and at the kill the corona flares. After: the shockwave rings
     out, the debris flies, the light comes back. World space. */
  const ECLIPSE_T = 1.4;
  function _drawEclipse(ctx, s) {
    const L = FINISH.SCENE_FATAL, e = Math.max(0, Math.min(1, (s.t - (L - ECLIPSE_T)) / ECLIPSE_T));
    if (e <= 0) return;
    const R = Math.max(60, s.r * 0.9), cx = s.cx, cy = s.cy;
    ctx.save();
    // the light round her, brighter as the disc closes
    const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * (1.6 + 0.5 * e));
    g.addColorStop(0, `rgba(255,248,220,${0.75 * e})`); g.addColorStop(0.35, `rgba(255,190,90,${0.45 * e})`); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * (1.6 + 0.5 * e), 0, Math.PI * 2); ctx.fill();
    // the corona's rays
    ctx.strokeStyle = `rgba(255,236,190,${0.5 * e})`; ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + s.t * 0.4, l = R * (1.05 + 0.35 * e * (0.6 + 0.4 * Math.sin(s.t * 9 + i * 1.7)));
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); ctx.stroke();
    }
    // the dark disc, sliding in from the left until it covers her
    const dx = (1 - _ease(e)) * R * 2.2;
    ctx.fillStyle = `rgba(4,5,10,${0.55 + 0.45 * e})`;
    ctx.beginPath(); ctx.arc(cx - dx, cy, R * 0.98, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,250,235,${0.9 * e})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx - dx, cy, R * 0.98, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function _drawAfter(ctx, s) {
    const a = s.t - (s.killT ?? s.t);
    if (a < 0 || a > FINISH.AFTER) return;
    const k = a / FINISH.AFTER, R = Math.max(60, s.r * 0.9), cx = s.cx, cy = s.cy;
    ctx.save();
    // the flash, gone in half a second
    if (a < 0.5) {
      const f = 1 - a / 0.5, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 3);
      g.addColorStop(0, `rgba(255,255,255,${f})`); g.addColorStop(0.4, `rgba(255,230,180,${0.6 * f})`); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 3, 0, Math.PI * 2); ctx.fill();
    }
    // two shockwave rings
    [0, 0.18].forEach((d, i) => {
      const kk = Math.max(0, k - d) / (1 - d);
      if (kk <= 0) return;
      ctx.strokeStyle = i ? `rgba(255,170,90,${0.7 * (1 - kk)})` : `rgba(230,240,255,${0.85 * (1 - kk)})`;
      ctx.lineWidth = (i ? 3 : 5) * (1 - kk) + 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, R * (0.5 + 3.2 * kk), R * (0.3 + 1.6 * kk), 0, 0, Math.PI * 2); ctx.stroke();
    });
    // debris: plates thrown out on every side, glowing at the torn edge
    for (let i = 0; i < 28; i++) {
      const ang = i / 28 * Math.PI * 2 + (i % 3) * 0.3, sp = R * (0.8 + (i * 37 % 10) / 6), d = sp * k;
      const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d * 0.7 + 40 * k * k, z = 2 + (i % 4);
      ctx.save(); ctx.translate(x, y); ctx.rotate(k * (i % 2 ? 6 : -5) + i);
      ctx.fillStyle = `rgba(70,76,92,${1 - k * 0.7})`; ctx.fillRect(-z, -z / 2, z * 2, z);
      ctx.fillStyle = `rgba(255,150,60,${0.8 * (1 - k)})`; ctx.fillRect(z - 1, -z / 2, 1.5, z);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The rockets of OPEN HAND (update223): `FIREWORKS` launches from her deck, each goes up, bursts and falls.
   *  Returns how many bursts are in the air (the tests read it). */
  const FIREWORKS = [
    { at: 0.15, fx: 0.22, h: 120, col: [255, 90, 90] },  { at: 0.55, fx: 0.62, h: 150, col: [90, 200, 255] },
    { at: 0.95, fx: 0.40, h: 135, col: [255, 220, 90] }, { at: 1.35, fx: 0.80, h: 115, col: [140, 255, 150] },
    { at: 1.75, fx: 0.30, h: 160, col: [230, 120, 255] }, { at: 2.15, fx: 0.70, h: 140, col: [255, 255, 255] },
    { at: 2.55, fx: 0.50, h: 170, col: [255, 160, 60] },
  ];
  const FW_UP = 0.7, FW_BURST = 1.3;
  function _drawFireworks(ctx, b, t) {
    let n = 0;
    ctx.save();
    FIREWORKS.forEach((f, i) => {
      const a = t - f.at;
      if (a < 0) return;
      const x0 = b.x + b.w * f.fx, y0 = b.y + 6, apex = y0 - f.h;
      if (a < FW_UP) {                                       // the rocket going up, a spark trail under it
        const k = a / FW_UP, y = y0 + (apex - y0) * (1 - (1 - k) * (1 - k));
        ctx.fillStyle = 'rgba(255,230,180,0.95)'; ctx.fillRect(x0 - 1, y - 2, 2, 4);
        for (let j = 1; j < 6; j++) { ctx.fillStyle = `rgba(255,170,80,${0.5 - j * 0.08})`; ctx.fillRect(x0 - 0.5 + Math.sin(j * 3 + a * 30), y + j * 4, 1, 2); }
        return;
      }
      const k = (a - FW_UP) / FW_BURST;
      if (k > 1) return;
      n++;
      const [r, g, bl] = f.col, R = 16 + 46 * Math.sqrt(k), fall = 26 * k * k;
      if (k < 0.15) {                                        // the flash of the burst
        const fl = 1 - k / 0.15, gr = ctx.createRadialGradient(x0, apex, 0, x0, apex, 30);
        gr.addColorStop(0, `rgba(255,255,255,${0.9 * fl})`); gr.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x0, apex, 30, 0, Math.PI * 2); ctx.fill();
      }
      const fade = Math.min(1, (1 - k) * 1.6);
      for (let j = 0; j < 34; j++) {                         // the stars, out on a ring and falling, each with its tail
        const ang = j / 34 * Math.PI * 2 + i, rr = R * (0.7 + 0.3 * ((j * 7) % 4) / 3);
        const x = x0 + Math.cos(ang) * rr, y = apex + Math.sin(ang) * rr + fall;
        const tx = x0 + Math.cos(ang) * rr * 0.72, ty = apex + Math.sin(ang) * rr * 0.72 + fall * 0.8;
        const tw = (j + Math.floor(t * 12)) % 3 ? 1 : 0.6;
        ctx.strokeStyle = `rgba(${r},${g},${bl},${0.45 * fade})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.85 * fade * tw})`; ctx.fillRect(x - 1, y - 1, 2, 2);
        ctx.fillStyle = `rgba(${r},${g},${bl},${fade * tw})`; ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    });
    ctx.restore();
    return n;
  }

  /** OPEN HAND is playing: every man still on his feet, theirs and ours, stands to attention and salutes. */
  function saluting() { return !!(_scene && !_scene.done && _scene.key === 'open_hand' && _scene.ship && !_scene.ship.destroyed); }

  function drawScene(ctx) {
    const s = _scene;
    if (!s || !s.ship) return;
    if (s.ship.destroyed) { if (s.kind === 'fatality') _drawAfter(ctx, s); return; }
    const sh = s.ship;
    /* the recipes' pictures were timed for 2.4 s (update183): the film runs them at the share they had */
    const t = s.kind === 'fatality' ? s.t / ((FINISH.SCENE_FATAL - ECLIPSE_T) / FINISH.BASE_SCENE) : s.t;
    const T = s.kind === 'fatality' ? FINISH.SCENE_FATAL : FINISH.SCENE_MERCY;
    const k = Math.min(1, s.t / T);
    const b = sh.roomBounds?.() ?? { x: 900, y: 200, w: 300, h: 200 };
    ctx.save();
    if (s.key === 'meltdown') {
      const c = _centre(_rooms(sh, 'reactor'), sh);
      const r = 18 + 150 * k * k, fl = 0.75 + 0.25 * Math.sin(t * 40);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.95 * fl})`); g.addColorStop(0.35, `rgba(255,220,120,${0.7 * fl})`);
      g.addColorStop(1, 'rgba(255,90,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
      if (k > 0.7) {                         // the core lets go: a white bloom over the whole hull
        const R2 = Math.max(b.w, b.h) * (0.4 + (k - 0.7) * 2.2);
        const w = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R2);
        w.addColorStop(0, `rgba(255,252,240,${Math.min(1, (k - 0.7) * 3)})`); w.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = w; ctx.beginPath(); ctx.arc(c.x, c.y, R2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (s.key === 'clipped_wings') {
      const e = _centre(_rooms(sh, 'engines'), sh);
      for (let i = 0; i < 7; i++) {          // a smoke trail from the torn engines
        const a = ((t * 1.6 + i / 7) % 1);
        ctx.fillStyle = `rgba(60,60,66,${0.5 * (1 - a)})`;
        ctx.beginPath(); ctx.arc(e.x + 30 + a * 120, e.y - a * 40 + 46 * k * k, 8 + a * 22, 0, Math.PI * 2); ctx.fill();
      }
    } else if (s.key === 'hindenburg') {
      _fireOrder(sh).forEach((r, i, all) => {
        const on = Math.max(0, Math.min(1, (t - (0.5 + 1.5 * (i / Math.max(1, all.length)))) / 0.4));
        if (on <= 0) return;
        const fl = 0.7 + 0.3 * Math.sin(t * 23 + i * 1.7);
        const g = ctx.createRadialGradient(r.cx, r.cy + r.h * 0.25, 0, r.cx, r.cy, Math.max(r.w, r.h) * 0.8);
        g.addColorStop(0, `rgba(255,230,140,${0.85 * on * fl})`); g.addColorStop(0.5, `rgba(255,110,20,${0.6 * on * fl})`);
        g.addColorStop(1, 'rgba(120,20,0,0)');
        ctx.fillStyle = g; ctx.fillRect(r.x - 10, r.y - 16, r.w + 20, r.h + 26);
      });
    } else if (s.key === 'ashes') {
      for (let i = 0; i < 46; i++) {          // ash, falling off the hull
        const sx = (i * 53) % Math.max(1, b.w), sp = 26 + (i * 17) % 40;
        const y = b.y + ((t * sp + (i * 31) % b.h) % (b.h + 40)) - 20;
        ctx.fillStyle = `rgba(${150 + (i % 3) * 25},${150 + (i % 3) * 20},${150 + (i % 3) * 18},${0.55 * k + 0.2})`;
        ctx.fillRect(b.x + sx + Math.sin(t * 2 + i) * 6, y, 2 + (i % 2), 2);
      }
      _rooms(sh, 'weapons').forEach((r, i) => {
        const hot = Math.max(0, Math.min(1, (t - (0.4 + i * 0.45)) / 0.3));
        if (hot <= 0) return;
        ctx.fillStyle = `rgba(40,30,28,${0.6 * hot})`; ctx.fillRect(r.x, r.y, r.w, r.h);
      });
    } else if (s.key === 'open_hand') {
      /* ── OPEN HAND: FIREWORKS, NOT A FLAG (update223, jj: "biała flaga słaba — niech przeciwnik wystrzeli
         fajerwerki, a reszta załogantów staje na baczność i salutuje"). Their men salute (crew.js `saluting`);
         over her hull, rockets go up one after another and burst in the colours of a parade. */
      _drawFireworks(ctx, b, t);
      ctx.textAlign = 'center'; ctx.font = 'bold 11px Share Tech Mono, monospace'; ctx.fillStyle = `rgba(150,255,200,${k})`;
      ctx.fillText('ALL HANDS — SALUTE', b.x + b.w / 2, b.y + b.h + 22);
    } else {
      // ── MERCY: a white flag goes up over every one of them ──
      const fx = b.x + b.w * 0.5, top = b.y - 4, pole = 64 * Math.min(1, t / 0.8) * (s.key === 'white_flag' ? 1.4 : 1);
      ctx.strokeStyle = '#d8dde6'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx, top); ctx.lineTo(fx, top - pole); ctx.stroke();
      if (pole > 20) {
        const W = s.key === 'white_flag' ? 54 : 34, H = s.key === 'white_flag' ? 32 : 20;
        ctx.fillStyle = '#f4f6fa';
        ctx.beginPath(); ctx.moveTo(fx, top - pole);
        for (let x = 0; x <= W; x += 3) ctx.lineTo(fx + x, top - pole + Math.sin(t * 7 - x * 0.18) * 3 * (x / W));
        for (let x = W; x >= 0; x -= 3) ctx.lineTo(fx + x, top - pole + H + Math.sin(t * 7 - x * 0.18) * 3 * (x / W));
        ctx.closePath(); ctx.fill();
      }
      if (s.key === 'stand_down') {
        ctx.textAlign = 'center'; ctx.font = 'bold 9px Share Tech Mono, monospace';
        _rooms(sh, 'weapons').concat(_rooms(sh, 'shields')).forEach(r => {
          ctx.fillStyle = `rgba(20,24,32,${0.55 * k})`; ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = `rgba(200,210,225,${k})`; ctx.fillText('POWERED DOWN', r.cx, r.cy + 3);
        });
      } else if (s.key === 'sanctuary') {
        const g = ctx.createLinearGradient(0, 0, 0, b.y + b.h);
        g.addColorStop(0, 'rgba(255,255,240,0)'); g.addColorStop(1, `rgba(255,255,235,${0.07 * Math.min(1, t / 0.6)})`);
        ctx.fillStyle = g;
        for (let i = 0; i < 4; i++) {          // soft edges: four widths of the same light
          const w = b.w * (0.35 + i * 0.22);
          ctx.fillRect(b.x + b.w / 2 - w / 2, 0, w, b.y + b.h);
        }
        ctx.strokeStyle = `rgba(255,250,220,${0.6 * Math.min(1, t / 0.6)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y - 26, b.w * 0.32, 9, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
    if (s.kind === 'fatality') _drawEclipse(ctx, s);
  }

  /* ── THE VOICE (jj: "na start z przeglądarki, później nagranie") ──
   * Low and slow, from the browser's own speech. Nothing in a test or a
   * browser without it — and a recorded file later replaces only this. */
  function _say(text) {
    _spoken.push(text);
    if (_spoken.length > 20) _spoken.shift();
    try {
      const ss = (typeof window !== 'undefined') ? window.speechSynthesis : null;
      if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
      if (typeof Audio !== 'undefined' && Audio.isMuted?.()) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.62; u.pitch = 0.05; u.volume = 1;
      const v = (ss.getVoices?.() ?? []).find(x => /en(-|_)?(GB|US)?/i.test(x.lang) && /male|daniel|george|david|fred|alex/i.test(x.name))
             ?? (ss.getVoices?.() ?? []).find(x => /^en/i.test(x.lang));
      if (v) u.voice = v;
      ss.cancel?.();
      ss.speak(u);
    } catch (e) { /* no voice is not an error */ }
  }

  /* ── DRAWING ────────────────────────────────────────────────── */
  const F = (s, b) => `${b ? 'bold ' : ''}${s}px Share Tech Mono, monospace`;

  function draw(ctx) {
    const W = (typeof Renderer !== 'undefined' && Renderer.getWidth) ? Renderer.getWidth() : 1280;
    const H = (typeof Renderer !== 'undefined' && Renderer.getHeight) ? Renderer.getHeight() : 720;
    const cx = W / 2;
    /* THE FILM'S FRAME (update193): the edges go dark and the black bars
       come down while a scene plays; SLOW-MO in the corner while the clock
       is held back. */
    const fk = filmK();
    if (fk > 0) {
      ctx.save();
      const v = ctx.createRadialGradient(cx, H / 2, Math.min(W, H) * 0.35, cx, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${0.55 * fk})`);
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
      const bh = FINISH.BARS * fk;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
      if (timeScale() < 0.95) {
        ctx.globalAlpha = fk * (0.6 + 0.4 * Math.sin((_scene?.t ?? 0) * 6));
        ctx.font = F(10, true); ctx.textAlign = 'right'; ctx.fillStyle = '#c8d8f0';
        ctx.fillText('◀◀ SLOW', W - 16, H - bh / 2 + 4);
      }
      ctx.restore();
    }
    if (_call && !_banner) {
      const c = _call;
      const pop = c.t < 0.18 ? 1.5 - (c.t / 0.18) * 0.5 : 1;
      const a = Math.max(0, Math.min(1, (FINISH.CALL - c.t) / 0.5));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, 150); ctx.scale(pop, pop);
      ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      ctx.font = F(30, true); ctx.lineWidth = 5; ctx.strokeStyle = '#1a0000';
      ctx.strokeText(FINISH.CALL_WORD, 0, 0);
      ctx.fillStyle = (Math.floor(c.t * 8) % 2) ? '#ff3a3a' : '#ffe0a0';
      ctx.fillText(FINISH.CALL_WORD, 0, 0);
      ctx.restore();
    }
    if (_banner) {
      const b = _banner, fat = b.kind === 'fatality';
      const pop = b.t < 0.45 ? 2.2 - _ease(b.t / 0.45) * 1.2 : 1 + 0.02 * Math.sin(b.t * 3);
      const a = Math.max(0, Math.min(1, (FINISH.BANNER - b.t) / 0.6));
      const y = Math.round(H * 0.14);     // above the hulls: the scene below is the point (update183)
      ctx.save();
      ctx.globalAlpha = a;
      // the whole screen goes their colour for a moment
      ctx.fillStyle = fat ? `rgba(120,0,10,${0.35 * Math.max(0, 1 - b.t / 1.2)})` : `rgba(230,240,255,${0.30 * Math.max(0, 1 - b.t / 1.2)})`;
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(cx - 360, 0, cx + 360, 0);
      const mid = fat ? 'rgba(160,0,20,0.55)' : 'rgba(40,170,150,0.45)';
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, mid); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - 360, y - 58, 720, 118);
      ctx.translate(cx, y); ctx.scale(pop, pop);
      ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      ctx.font = F(46, true); ctx.lineWidth = 6; ctx.strokeStyle = fat ? '#200000' : '#00201c';
      /* the word spelled out, a letter at a time (update193) */
      const shown = Math.max(1, Math.min(b.word.length, Math.ceil(b.t / 0.09)));
      const word = b.word.slice(0, shown) + ' '.repeat(b.word.length - shown);
      ctx.strokeText(word, 0, 0);
      const tg = ctx.createLinearGradient(0, -40, 0, 4);
      if (fat) { tg.addColorStop(0, '#ffd0c0'); tg.addColorStop(1, '#ff1a2a'); }
      else     { tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#5fd8c4'); }
      ctx.fillStyle = tg; ctx.fillText(word, 0, 0);
      ctx.globalAlpha = a * _ease((b.t - 0.7) / 0.5);          // the record's name after the word
      ctx.font = F(20, true); ctx.lineWidth = 4;
      ctx.strokeText(b.title, 0, 30);
      ctx.fillStyle = fat ? '#ffb070' : '#d8fff4';
      ctx.fillText(b.title, 0, 30);
      if (b.karma) {
        ctx.font = F(9, true); ctx.fillStyle = '#c8d8f0';
        ctx.fillText(`KARMA ${b.karma}`, 0, 46);
      }
      ctx.restore();
    }
  }

  return {
    begin, end, update, draw,
    noteHit, noteShot, noteDeath,
    finishing, fightRefusal, refusal, pending, peekPending,
    busy, sceneDone, drawScene, hullTransform, sceneBursts, scene: () => _scene, saluting, _drawFireworks, FIREWORKS,
    timeScale, cinema, filmK, holdVictory,
    RECIPES, FINISH,
    banner: () => _banner, call: () => _call, spoken: () => _spoken.slice(),
    state: () => _f,
    /* tests: force a banner off */
    clearBanner() { _banner = null; _call = null; },
  };
})();

if (typeof window !== 'undefined') {
  window.Finish = Finish;
  window.FINISH = FINISH;
}
