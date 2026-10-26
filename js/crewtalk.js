/* ============================================================
   MOON WARS — crewtalk.js  (update173)

   THE CREW TALKS, AND A GOOD VOLLEY IS CELEBRATED.

   jj (25.10): short lines over a man's head with the radio blip —
   "Fire in engines!", "Shields down!", "Got him!" — rare, one at a
   time, the more important line first, and everything into the log.
   jj (26.10): "walka musi być ciekawa… jak ktoś wejdzie z dobrą bronią
   i ma specjalizację plus bonusy to robi miazgę — gracze muszą się
   cieszyć z miazgi". So a run of wrecked modules and dead boarders in
   quick succession is a STREAK: DOUBLE → OVERKILL → MASSACRE, a banner,
   a stinger, a harder shake and a little XP for whoever did it.

   Mockup: mk_crew_talk2.png — the bubble fits inside ONE module, small
   text, wrapped; the banner is a narrow strip under the top bar.

   Everything the fight says is found by WATCHING the two ships (edges:
   a fire that was not there, shields that just fell), so the rest of
   the game does not have to call in. Two things do call in, because
   only they know WHO did it: a kill (CrewMember.creditKill) and an
   enemy module wrecked by our shot (Ship.receiveHit).
   ============================================================ */

'use strict';

const CrewTalk = (() => {

  const TALK = {
    LIFE:     3.0,    // seconds a line stays up
    GAP:      1.0,    // quiet seconds between two lines
    PER_MAN:  8,      // a man says nothing new for this long
    PENDING:  2.5,    // a line not yet said goes stale after this
    MEDIC_HP: 0.35,   // "I need a medic" below this share of his hp
  };
  const STREAK = {
    WINDOW: 2.0,      // seconds between two blows to keep the chain
    XP:     12,       // to the man who did it, for every blow after the first
    LIFE:   2.6,      // the banner's time on screen
    TIERS:  [null, null, 'DOUBLE!', 'OVERKILL!', 'MASSACRE!'],
  };

  /* What can be said. `pri`: a higher line interrupts a lower one and
     wins the queue. `sev` is the colour of the frame and of the log
     line. Several phrasings, taken in turn, so the tenth fire does not
     sound like the first. */
  const LINES = {
    boarders:     { pri: 90, sev: 'alert', say: a => a.deck ? [`Boarders on deck ${a.deck}!`, `Intruders — deck ${a.deck}!`] : ['Boarders incoming!', 'They are coming across!'] },
    hullLow:      { pri: 85, sev: 'alert', say: () => ["Hull critical — we can't take much more!", 'Hull is failing!'] },
    breach:       { pri: 75, sev: 'alert', say: a => [`Breach in ${a.sys} — O₂ falling!`, `Hull breach, ${a.sys}!`] },
    fire:         { pri: 70, sev: 'alert', say: a => [`Fire in ${a.sys}!`, `${a.sys} is burning!`] },
    medic:        { pri: 65, sev: 'warn',  say: () => ['I need a medic!', "I'm hit — medbay!"] },
    shieldsDown:  { pri: 60, sev: 'warn',  say: () => ['Shields down!', "We're open — shields are gone!"] },
    wrecked:      { pri: 55, sev: 'warn',  say: a => [`${a.sys} wrecked — on it.`, `Lost ${a.sys}!`] },
    hullHalf:     { pri: 50, sev: 'warn',  say: () => ['Hull at half!', 'Half the hull is gone!'] },
    gotHim:       { pri: 48, sev: 'good',  say: () => ['Got him!', 'One down!', "He's done!"] },
    theirWrecked: { pri: 45, sev: 'good',  say: a => [`Their ${a.sys} is down!`, `Hit — their ${a.sys} is out!`] },
    theirShields: { pri: 40, sev: 'good',  say: () => ['Their shields are down!', "They're open — fire!"] },
  };
  const SEV_COL = { alert: '#ff5a4a', warn: '#ffb020', good: '#5dff9e', info: '#8fd4ff' };

  let _time = 0;
  let _cur = null;         // { crew, key, text, sev, pri, t }
  let _pending = null;     // the best line waiting for its turn
  let _gapT = 0;
  let _lastBy = new Map(); // crew → time of his last line
  let _turn = {};          // key → how many times said (picks the phrasing)
  let _snap = null;        // what the ships looked like last frame
  let _chain = [];         // the current streak: [{ t, kind, who, label, skill }]
  let _banner = null;      // { tier, title, sub, t }
  let _said = [];          // every line said this fight (tests, debugging)

  function reset() {
    _time = 0; _cur = null; _pending = null; _gapT = 0;
    _lastBy = new Map(); _turn = {}; _snap = null;
    _chain = []; _banner = null; _said = [];
  }

  // ── Talking ───────────────────────────────────────────────

  function _canSpeak(crew) {
    return !!crew && crew.isPlayer && !crew.isPet && !crew.dead && crew.alive !== false;
  }

  /** Put a line in a man's mouth. True when it is said now or queued. */
  function say(crew, key, args = {}) {
    const L = LINES[key];
    if (!L || !_canSpeak(crew)) return false;
    const last = _lastBy.get(crew);
    if (last !== undefined && _time - last < TALK.PER_MAN && !(_cur && _cur.crew === crew && L.pri > _cur.pri)) return false;
    const opts = L.say(args);
    const n = _turn[key] ?? 0;
    const line = { crew, key, text: opts[n % opts.length], sev: L.sev, pri: L.pri, t: 0, at: _time };
    if (_cur && L.pri > _cur.pri) { _turn[key] = n + 1; _show(line); return true; }
    if (!_cur && _gapT <= 0) { _turn[key] = n + 1; _show(line); return true; }
    if (!_pending || L.pri > _pending.pri) { _pending = line; return true; }
    return false;
  }

  function _show(line) {
    _cur = line; _cur.t = 0; _pending = _pending === line ? null : _pending;
    _lastBy.set(line.crew, _time);
    _said.push({ who: line.crew.name, key: line.key, text: line.text });
    if (typeof UI !== 'undefined') {
      const msg = `${line.crew.name}: ${line.text}`;
      (UI.logLine ?? UI.notify)(msg, line.sev);
    }
    if (typeof Audio !== 'undefined' && Audio.sfx?.voiceBlip) {
      const p = _pitch(line.crew);
      Audio.sfx.voiceBlip(p);
      setTimeout(() => Audio.sfx.voiceBlip(p * 1.04), 80);
      setTimeout(() => Audio.sfx.voiceBlip(p * 0.97), 160);
    }
  }

  /** Every man his own voice: a pitch from his name. */
  function _pitch(crew) {
    let h = 0;
    for (const ch of String(crew.name ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 0.82 + (h % 40) / 100;
  }

  // ── Watching the fight ────────────────────────────────────

  const _alive = (ship) => (ship?.crew ?? []).filter(c => c && c.alive !== false && !c.dead);
  const _ours  = (ship) => _alive(ship).filter(c => c.isPlayer && !c.isPet);
  const _roomOf = (ship, x, y) => (ship?.rooms ?? []).find(r => r.contains?.(x, y)) ?? null;
  const _sysName = (room) => room?.system?.label ?? (room?.type ? room.type[0].toUpperCase() + room.type.slice(1) : 'the hold');

  /** The man of ours nearest a room on our ship — the one who sees it. */
  function _nearest(ship, room) {
    const men = _ours(ship).filter(c => _roomOf(ship, c.x, c.y));
    if (!men.length || !room) return men[0] ?? null;
    return men.sort((a, b) => Math.hypot(a.x - room.cx, a.y - room.cy) - Math.hypot(b.x - room.cx, b.y - room.cy))[0];
  }
  /** A man at a console of this kind, or anyone aboard. */
  function _at(ship, type) {
    const sys = ship?.getSystem?.(type);
    const op = sys && ship.consoleOperator ? ship.consoleOperator(sys.roomId) : null;
    if (op && _canSpeak(op)) return op;
    return _ours(ship)[0] ?? null;
  }
  function _gunner(P) {
    const room = (P?.rooms ?? []).find(r => r.system?.type === 'weapons' && (P.crewOperating?.(r.id) ?? []).some(_canSpeak));
    return room ? P.crewOperating(room.id).find(_canSpeak) : _ours(P)[0] ?? null;
  }
  function _deckOf(ship, room) {
    if (!room) return null;
    const ys = [...new Set((ship.rooms ?? []).map(r => r.y))].sort((a, b) => a - b);
    return ys.indexOf(room.y) + 1 || null;
  }

  function _take(cm) {
    const P = cm.playerShip, E = cm.enemyShip;
    const wreckedOf = (s) => new Set((s?.systems ?? []).filter(x => x.level > 0 && x.type !== 'reactor' && (x.workingLevels ?? 1) <= 0).map(x => x));
    return {
      fires:    new Set((P?.fires?.fires ?? []).filter(f => f && !f.out).map(f => f.roomId)),
      breaches: new Set((P?.breaches?.breaches ?? []).filter(b => b && !b.sealed).map(b => b.roomId)),
      shields:  P?.shieldBars ?? 0,
      theirShields: E && !E.destroyed ? (E.shieldBars ?? 0) : 0,
      hull:     P && P.hullMax > 0 ? P.hull / P.hullMax : 1,
      boarders: !!cm.intrudersAboard?.(),
      hurt:     new Set(_ours(P).filter(c => c.maxHp > 0 && c.hp / c.maxHp < TALK.MEDIC_HP)),
      wrecked:  wreckedOf(P),
      theirWrecked: wreckedOf(E),
    };
  }

  /** Compare this frame with the last; say what changed. */
  function watch(cm) {
    const P = cm?.playerShip;
    if (!P) return;
    const now = _take(cm);
    const was = _snap;
    _snap = now;
    if (!was) return;                       // the first look only takes stock
    const E = cm.enemyShip;

    if (now.boarders && !was.boarders) {
      const theirs = _alive(P).find(c => !c.isPlayer);
      const room = theirs ? _roomOf(P, theirs.x, theirs.y) : null;
      say(_nearest(P, room) ?? _ours(P)[0], 'boarders', { deck: theirs ? _deckOf(P, room) : null });
    }
    if (now.hull < 0.25 && was.hull >= 0.25) say(_at(P, 'piloting'), 'hullLow');
    else if (now.hull < 0.5 && was.hull >= 0.5) say(_at(P, 'piloting'), 'hullHalf');
    now.breaches.forEach(id => { if (!was.breaches.has(id)) { const r = P.getRoomById?.(id); say(_nearest(P, r), 'breach', { sys: _sysName(r) }); } });
    now.fires.forEach(id => { if (!was.fires.has(id)) { const r = P.getRoomById?.(id); say(_nearest(P, r), 'fire', { sys: _sysName(r) }); } });
    now.hurt.forEach(c => { if (!was.hurt.has(c)) say(c, 'medic'); });
    if (now.shields === 0 && was.shields > 0) say(_at(P, 'shields'), 'shieldsDown');
    now.wrecked.forEach(s => { if (!was.wrecked.has(s)) { const r = P.getRoomById?.(s.roomId); say(_nearest(P, r), 'wrecked', { sys: s.label ?? _sysName(r) }); } });
    if (E && !E.destroyed) {
      if (now.theirShields === 0 && was.theirShields > 0) say(_gunner(P), 'theirShields');
      now.theirWrecked.forEach(s => { if (!was.theirWrecked.has(s)) say(_gunner(P), 'theirWrecked', { sys: s.label ?? 'module' }); });
    }
  }

  // ── The streak ────────────────────────────────────────────

  /** One of ours killed one of theirs. `skill` is how: 'combat' (a swing)
   *  or 'weapons' (a shot). */
  function noteKill(killer, victim, skill = 'combat') {
    if (!killer || !killer.isPlayer || killer.isPet || !victim || victim.isPlayer) return false;
    say(killer, 'gotHim');
    _blow({ kind: 'kill', who: killer, label: victim.name, skill });
    return true;
  }

  /** Our shot took the last working level off one of their modules. */
  function noteWreck(sys, gunners = []) {
    const who = (gunners ?? []).find(_canSpeak) ?? null;
    _blow({ kind: 'module', who, label: sys?.label ?? 'module', skill: 'weapons' });
    return true;
  }

  function _blow(b) {
    b.t = _time;
    const last = _chain[_chain.length - 1];
    if (!last || _time - last.t > STREAK.WINDOW) _chain = [];
    _chain.push(b);
    const n = _chain.length;
    if (n < 2) return;
    const tier = Math.min(4, n);
    const title = STREAK.TIERS[tier];
    // the XP: whoever struck this blow, in the skill he struck it with
    let xp = 0;
    if (b.who && b.who.addXP) xp = b.who.addXP(b.skill, STREAK.XP) || 0;
    _chain.xp = (_chain.xp ?? 0) + xp;
    const mods = _chain.filter(x => x.kind === 'module').length, kills = _chain.filter(x => x.kind === 'kill').length;
    const what = [mods ? `${mods} MODULE${mods > 1 ? 'S' : ''} WRECKED` : null, kills ? `${kills} DOWN` : null].filter(Boolean).join(' + ');
    const span = (_chain[_chain.length - 1].t - _chain[0].t).toFixed(1);
    const ace = _ace(_chain);
    const sub = [`${what} IN ${span} s`,
                 ace ? `${String(ace.who.name).toUpperCase()} — ${ace.skill === 'combat' ? 'COMBAT' : 'GUNNERY'} ${ace.who.getSkillLevel?.(ace.skill) ?? 0}` : null,
                 _chain.xp ? `+${_chain.xp} XP` : null].filter(Boolean).join('  ·  ');
    _banner = { tier, title, sub, t: 0 };
    if (typeof Audio !== 'undefined') Audio.stinger?.(tier >= 4 ? 'massacre' : tier === 3 ? 'overkill' : 'double');
    if (typeof Camera !== 'undefined') Camera.shake?.(6 + tier * 3, 0.35);
    if (typeof UI !== 'undefined') (UI.logLine ?? UI.notify)(`${title.replace('!', '')}: ${what}`, 'warn');
  }

  /** Who did most of it. */
  function _ace(chain) {
    const n = new Map();
    chain.forEach(b => { if (b.who) n.set(b.who, (n.get(b.who) ?? 0) + 1); });
    let best = null;
    n.forEach((k, who) => { if (!best || k > best.k) best = { who, k, skill: chain.filter(b => b.who === who).pop().skill }; });
    return best;
  }

  // ── The clock ─────────────────────────────────────────────

  function update(dt, cm) {
    _time += dt;
    if (_cur) {
      _cur.t += dt;
      const gone = !_canSpeak(_cur.crew);
      if (_cur.t >= TALK.LIFE || gone) { _cur = null; _gapT = TALK.GAP; }
    } else if (_gapT > 0) _gapT -= dt;
    if (_pending && _time - _pending.at > TALK.PENDING) _pending = null;
    if (!_cur && _gapT <= 0 && _pending && _canSpeak(_pending.crew)) {
      const p = _pending; _pending = null;
      _turn[p.key] = (_turn[p.key] ?? 0) + 1;
      _show(p);
    }
    if (_banner) { _banner.t += dt; if (_banner.t >= STREAK.LIFE) _banner = null; }
    if (cm) watch(cm);
  }

  // ── Drawing ───────────────────────────────────────────────

  const F = (s, b) => `${b ? 'bold ' : ''}${s}px Share Tech Mono, monospace`;

  function _wrap(ctx, text, maxW) {
    const words = String(text).split(' '), lines = [];
    let cur = '';
    words.forEach(w => {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /** The bubble's box, inside the module the speaker stands in. */
  function bubbleRect(ctx, line, ships) {
    const c = line.crew;
    const ship = (ships ?? []).find(s => _roomOf(s, c.x, c.y));
    const room = ship ? _roomOf(ship, c.x, c.y) : null;
    const maxW = Math.max(60, Math.min(100, (room?.w ?? 100) - 4));
    ctx.font = F(9, true);
    const lines = _wrap(ctx, line.text, maxW - 12);
    ctx.font = F(7, true);
    const nameW = ctx.measureText(String(c.name).toUpperCase() + ' ◂))').width;
    ctx.font = F(9, true);
    const w = Math.round(Math.min(maxW, Math.max(nameW, ...lines.map(l => ctx.measureText(l).width)) + 12));
    const h = 13 + lines.length * 10;
    let x = c.x;
    if (room) x = Math.max(room.x + w / 2 + 2, Math.min(room.x + room.w - w / 2 - 2, x));
    const tipY = c.y - 18;
    return { x: Math.round(x - w / 2), y: Math.round(tipY - h - 6), w, h, tipX: c.x, tipY, lines, room };
  }

  function draw(ctx, ships = []) {
    if (_cur) {
      const R = bubbleRect(ctx, _cur, ships);
      const col = SEV_COL[_cur.sev] ?? SEV_COL.info;
      const a = Math.min(1, _cur.t / 0.12, (TALK.LIFE - _cur.t) / 0.3);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = 'rgba(6,12,24,0.92)'; ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(R.x + 0.5, R.y + 0.5, R.w, R.h, 3); ctx.fill(); ctx.stroke();
      const tx = Math.max(R.x + 6, Math.min(R.x + R.w - 6, R.tipX));
      ctx.beginPath(); ctx.moveTo(tx - 4, R.y + R.h + 0.5); ctx.lineTo(tx, R.y + R.h + 6); ctx.lineTo(tx + 4, R.y + R.h + 0.5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(6,12,24,1)'; ctx.fillRect(tx - 3, R.y + R.h - 1, 6, 2);
      ctx.textAlign = 'left';
      ctx.fillStyle = col; ctx.font = F(7, true);
      ctx.fillText(String(_cur.crew.name).toUpperCase() + ' ◂))', R.x + 6, R.y + 9);
      ctx.fillStyle = '#f2f6ff'; ctx.font = F(9, true);
      R.lines.forEach((l, i) => ctx.fillText(l, R.x + 6, R.y + 19 + i * 10));
      ctx.restore();
    }
    if (_banner) {
      const W = (typeof Renderer !== 'undefined' && Renderer.getWidth) ? Renderer.getWidth() : 1280;
      const cx = W / 2, y = 92, b = _banner;
      const pop = b.t < 0.15 ? 1.35 - (b.t / 0.15) * 0.35 : 1;
      const a = Math.max(0, Math.min(1, (STREAK.LIFE - b.t) / 0.4));
      const hot = b.tier >= 4 ? ['#ffd0d0', '#ff3048'] : b.tier === 3 ? ['#fff3a0', '#ff7a1a'] : ['#e0f4ff', '#3ab0ff'];
      ctx.save();
      ctx.globalAlpha = a;
      const g = ctx.createLinearGradient(cx - 170, 0, cx + 170, 0);
      g.addColorStop(0, 'rgba(255,120,20,0)'); g.addColorStop(0.5, b.tier >= 4 ? 'rgba(255,40,60,0.32)' : 'rgba(255,120,20,0.28)'); g.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - 170, y - 22, 340, 40);
      ctx.translate(cx, y); ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.font = F(22, true); ctx.lineWidth = 4; ctx.strokeStyle = '#2a0800';
      ctx.strokeText(b.title, 0, 4);
      const tg = ctx.createLinearGradient(0, -17, 0, 4);
      tg.addColorStop(0, hot[0]); tg.addColorStop(1, hot[1]);
      ctx.fillStyle = tg; ctx.fillText(b.title, 0, 4);
      ctx.font = F(8, true); ctx.fillStyle = '#ffd9a0';
      ctx.fillText(b.sub, 0, 15);
      ctx.restore();
    }
  }

  return {
    TALK, STREAK, LINES,
    reset, say, update, watch, draw, bubbleRect,
    noteKill, noteWreck,
    current: () => _cur, pending: () => _pending, banner: () => _banner,
    chain: () => _chain.slice(), said: () => _said.slice(), time: () => _time,
  };
})();

window.CrewTalk = CrewTalk;
