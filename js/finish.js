/* ============================================================
   MOON WARS — finish.js  (update182)

   FINISH HER! — FATALITY AND MERCY, AS RECORDS IN THE CAPTAIN'S BOOK.

   jj 30.10 ("Papirus super pomysł, Pieczęć też super, pasuje wszystko"):
   when their hull falls to FINISH_AT (15%) or lower, the screen says
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
  AT:      0.15,   // their hull share at which FINISH HER! comes up
  SALVO:   0.6,    // s: "one salvo"
  WINDOW:  2.0,    // s: "within 2 s"
  QUIET:   3.0,    // s: WHITE FLAG's held fire
  BANNER:  4.2,    // s: the big banner on screen
  CALL:    2.2,    // s: the FINISH HER! call on screen
  /* THE SCENES (update183): how long each side is played before the
     fight moves on — a FATALITY before the hull goes, a MERCY before
     their surrender comes up (game.js waits on `sceneDone`). */
  SCENE_FATAL: 2.4,
  SCENE_MERCY: 2.4,
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
    _call = null; _pending = null; _scene = null;
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
    return e.hullMax > 0 && e.hull > 0 && !e.destroyed && e.hull <= e.hullMax * FINISH.AT;
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
    _scene = { key, kind, t: 0, ship: e, fired: new Set(), done: false };
    if (kind === 'fatality') _fatality(e);
    else {
      if (e && e.hull <= 0) e.hull = 1;      // the hit that brought it is not the end of them
      /* CEASE FIRE: what is still in the air goes wide — a shell that
         lands after the seal would kill the men who just struck. */
      if (typeof CombatManager !== 'undefined') {
        (CombatManager._projectiles ?? []).forEach(p => { if (p.fromPlayer && !p.fromField && !p.hit) p.done = true; });
      }
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
  function update(dt) {
    if (_f) {
      _f.t += dt;
      const now = finishing();
      if (now && !_f.on && !_f.used) {
        _f.on = true;
        _call = { t: 0 };
        _say('Finish her!');
        if (typeof Audio !== 'undefined') Audio.stinger?.('overkill');
      }
      if (now && !_f.used) _check(null);      // WHITE FLAG waits on the clock
    }
    if (_scene) {
      _scene.t += dt;
      _sceneEvents(_scene);
      if (_scene.kind === 'fatality' && !_scene.done && (_scene.t >= FINISH.SCENE_FATAL || _scene.ship?.destroyed)) {
        _scene.done = true;
        if (!_scene.ship?.destroyed) _kill(_scene.ship);
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
      if (typeof Camera !== 'undefined') Camera.shake?.(4 + b.scale * 8, 0.25);
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

  function drawScene(ctx) {
    const s = _scene;
    if (!s || !s.ship || s.ship.destroyed) return;
    const sh = s.ship, t = s.t;
    const T = s.kind === 'fatality' ? FINISH.SCENE_FATAL : FINISH.SCENE_MERCY;
    const k = Math.min(1, t / T);
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
      } else if (s.key === 'open_hand') {
        const sweep = b.x + (b.w + 60) * k;
        (sh.rooms ?? []).forEach(r => { if (r.cx < sweep) { ctx.fillStyle = 'rgba(60,255,160,0.16)'; ctx.fillRect(r.x, r.y, r.w, r.h); } });
        ctx.textAlign = 'center'; ctx.font = 'bold 11px Share Tech Mono, monospace'; ctx.fillStyle = `rgba(150,255,200,${k})`;
        ctx.fillText('ALL HANDS — STAND DOWN', b.x + b.w / 2, b.y + b.h + 22);
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
    if (_call && !_banner) {
      const c = _call;
      const pop = c.t < 0.18 ? 1.5 - (c.t / 0.18) * 0.5 : 1;
      const a = Math.max(0, Math.min(1, (FINISH.CALL - c.t) / 0.5));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, 150); ctx.scale(pop, pop);
      ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      ctx.font = F(30, true); ctx.lineWidth = 5; ctx.strokeStyle = '#1a0000';
      ctx.strokeText('FINISH HER!', 0, 0);
      ctx.fillStyle = (Math.floor(c.t * 8) % 2) ? '#ff3a3a' : '#ffe0a0';
      ctx.fillText('FINISH HER!', 0, 0);
      ctx.restore();
    }
    if (_banner) {
      const b = _banner, fat = b.kind === 'fatality';
      const pop = b.t < 0.22 ? 1.8 - (b.t / 0.22) * 0.8 : 1;
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
      ctx.strokeText(b.word, 0, 0);
      const tg = ctx.createLinearGradient(0, -40, 0, 4);
      if (fat) { tg.addColorStop(0, '#ffd0c0'); tg.addColorStop(1, '#ff1a2a'); }
      else     { tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#5fd8c4'); }
      ctx.fillStyle = tg; ctx.fillText(b.word, 0, 0);
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
    busy, sceneDone, drawScene, hullTransform, sceneBursts, scene: () => _scene,
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
