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
};

const Finish = (() => {

  let _f = null;          // this fight: see begin()
  let _banner = null;     // { kind, word, title, t }
  let _call = null;       // { t } — FINISH HER!
  let _pending = null;    // a MERCY waiting for game.js
  let _spoken = [];       // what the voice said (tests read it)

  function _now() { return _f ? _f.t : 0; }

  /** A new fight. Called from CombatManager.begin. */
  function begin(enemy, opts = {}) {
    _f = {
      t: 0, hits: [], shots: [], kills: 0, used: false, on: false,
      boss: !!opts.boss, enemy: enemy ?? null,
      bad: { o2: false },       // SANCTUARY: a hit on their O₂ or medbay this fight
      wfEngines: -1, wfCockpit: -1,   // WHITE FLAG: when the engines, then the cockpit
    };
    _call = null; _pending = null;
  }

  /** The fight is over. The banner stays up to the end of its time. */
  function end() { _f = null; _call = null; }

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

  /** Their hull to nothing — the ordinary victory follows (combat.js). */
  function _fatality(e) {
    if (!e) return;
    e.hull = 0;
    e.destroyed = true;
    e.fatality = true;
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
    if (_call) { _call.t += dt; if (_call.t >= FINISH.CALL) _call = null; }
    if (_banner) { _banner.t += dt; if (_banner.t >= FINISH.BANNER) _banner = null; }
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
      const y = Math.round(H * 0.3);
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
