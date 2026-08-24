/* ============================================================
   MOON WARS — wreck.js
   Derelicts you actually walk through, and the clamps you dock with.

   Two things live here:

     1. DOCKING — a short, skippable minigame. A marker slides across a
        bar; stop it in the green and the clamps bite cleanly. It lasts
        seconds, never blocks you (there is always AUTO-DOCK), and the
        result MATTERS: a clean dock buys you time on the wreck, a bad
        one costs hull.

     2. THE DERELICT — a real Ship, built from an enemy layout, shot to
        pieces and unpowered, with void spiders nesting in it. It is an
        ordinary hostile ship as far as every other system is concerned,
        which is exactly why you can send a boarding party into it and
        fight room by room using machinery that already works.

   No game-state changes here: game.js drives both.
   ============================================================ */

'use strict';

const DockingGame = (() => {

  const BAR_W = 560, BAR_H = 26;
  const BAR_X = (1280 - BAR_W) / 2, BAR_Y = 330;

  let _open   = false;
  let _pos    = 0;        // 0..1 along the bar
  let _dir    = 1;
  let _speed  = 0.85;     // laps per second
  let _green  = { start: 0.42, size: 0.16 };
  let _result = null;     // 'perfect' | 'ok' | 'bad' | 'auto'
  let _holdT  = 0;        // little pause so the player sees the outcome
  let _opts   = {};
  let _zones  = [];

  function open(opts = {}) {
    _open = true;
    _opts = opts;
    _result = null;
    _holdT = 0;
    _pos = 0; _dir = 1;
    // Harder further out: the band narrows and the marker moves faster.
    const sector = opts.sector ?? 1;
    _speed = 0.75 + sector * 0.12;
    _green.size  = Utils.clamp(0.22 - sector * 0.02, 0.09, 0.22);
    _green.start = Utils.randFloat(0.12, 0.88 - _green.size);
  }

  function isOpen() { return _open; }

  /** How close to the middle of the green band we stopped. 0..1 */
  function _accuracy() {
    const mid = _green.start + _green.size / 2;
    const half = _green.size / 2;
    const off = Math.abs(_pos - mid);
    if (off > half) return 0;
    return 1 - off / half;
  }

  function _finish(kind) {
    _result = kind;
    _holdT = 0.9;
    Audio.sfx[kind === 'bad' ? 'hullHit' : 'powerUp']?.();
  }

  function update(dt) {
    if (!_open) return null;

    if (_result) {
      _holdT -= dt;
      if (_holdT <= 0) {
        _open = false;
        const r = _result;
        _result = null;
        return r;
      }
      return null;
    }

    _pos += _dir * _speed * dt;
    if (_pos >= 1) { _pos = 1; _dir = -1; }
    if (_pos <= 0) { _pos = 0; _dir = 1; }

    const mx = Input.mouse.x, my = Input.mouse.y;
    if (Input.mouse.leftPressed) {
      for (const z of _zones) {
        if (Utils.pointInRect(mx, my, z.x, z.y, z.w, z.h)) {
          Audio.sfx.uiClick?.();
          if (z.act === 'auto')  { _finish('auto'); return null; }
          if (z.act === 'abort') { _open = false; return 'abort'; }
          if (z.act === 'lock')  { return _lock(); }
        }
      }
      return _lock();          // clicking anywhere else is also a lock
    }
    if (Input.isPressed?.('Space')) return _lock();
    return null;
  }

  function _lock() {
    const a = _accuracy();
    _finish(a >= 0.75 ? 'perfect' : a > 0 ? 'ok' : 'bad');
    return null;
  }

  function draw(ctx) {
    if (!_open) return;
    _zones = [];
    Renderer.drawBackground?.(0);
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,14,0.86)';
    ctx.fillRect(0, 0, 1280, 720);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#4db8ff';
    ctx.font = '24px Orbitron, monospace';
    ctx.fillText(_opts.title || 'DOCKING MANOEUVRE', 640, 232);
    ctx.fillStyle = '#5f7893';
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.fillText('Stop the marker in the green to mate the clamps — '
               + 'CLICK or SPACE', 640, 256);

    // Bar
    ctx.fillStyle = '#0a1018';
    ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 4); ctx.fill();
    ctx.strokeStyle = '#1e2d4a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 4); ctx.stroke();

    // Green band, with a brighter core for a perfect lock
    const gx = BAR_X + _green.start * BAR_W, gw = _green.size * BAR_W;
    ctx.fillStyle = 'rgba(26,255,140,0.22)';
    ctx.fillRect(gx, BAR_Y, gw, BAR_H);
    ctx.fillStyle = 'rgba(26,255,140,0.45)';
    ctx.fillRect(gx + gw * 0.375, BAR_Y, gw * 0.25, BAR_H);
    ctx.strokeStyle = '#1aff8c';
    ctx.strokeRect(gx, BAR_Y, gw, BAR_H);

    // Marker
    const px = BAR_X + _pos * BAR_W;
    ctx.fillStyle = _result ? '#c8e8ff' : '#ffd780';
    ctx.fillRect(px - 2, BAR_Y - 8, 4, BAR_H + 16);

    // Outcome
    if (_result) {
      const txt = { perfect: 'CLEAN LOCK', ok: 'CLAMPS HELD',
                    bad: 'HARD DOCK — HULL SCRAPED', auto: 'AUTO-DOCK' }[_result];
      const col = { perfect: '#1aff8c', ok: '#4db8ff',
                    bad: '#ff5566', auto: '#ffb020' }[_result];
      ctx.fillStyle = col;
      ctx.font = '18px Orbitron, monospace';
      ctx.fillText(txt, 640, BAR_Y + 70);
    } else {
      _btn(ctx, 640 - 250, BAR_Y + 60, 150, 34, 'AUTO-DOCK',
           { act: 'auto', col: '#ffb020', sub: 'costs 1 He2' });
      _btn(ctx, 640 - 75, BAR_Y + 60, 150, 34, 'LOCK CLAMPS',
           { act: 'lock', col: '#1aff8c' });
      _btn(ctx, 640 + 100, BAR_Y + 60, 150, 34, 'BREAK OFF',
           { act: 'abort', col: '#ff5566' });
    }
    ctx.restore();
  }

  function _btn(ctx, x, y, w, h, label, opts = {}) {
    const { col = '#4db8ff', act = null, sub = null } = opts;
    ctx.save();
    const hot = Utils.pointInRect(Input.mouse.x, Input.mouse.y, x, y, w, h);
    ctx.fillStyle = hot ? 'rgba(26,140,255,0.16)' : 'rgba(13,17,32,0.92)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = '12px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + (sub ? -1 : 4));
    if (sub) {
      ctx.fillStyle = '#5f7893';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 12);
    }
    ctx.restore();
    if (act) _zones.push({ x, y, w, h, act });
  }

  return { open, isOpen, update, draw,
           _state: () => ({ pos: _pos, green: { ..._green }, result: _result }),
           _set: (o) => { if (o.pos !== undefined) _pos = o.pos;
                          if (o.green) Object.assign(_green, o.green); },
           _zoneFor: (act) => _zones.find(z => z.act === act) || null };
})();

/** What a docking result is worth. */
const DOCK_OUTCOMES = {
  perfect: { bonusSeconds: 15, hullDamage: 0, fuel: 0,
             message: 'Clean lock — the clamps bit first time. Extra time aboard.' },
  ok:      { bonusSeconds: 0,  hullDamage: 0, fuel: 0,
             message: 'Clamps held.' },
  bad:     { bonusSeconds: -8, hullDamage: 2, fuel: 0,
             message: 'Hard dock — you scraped the hull coming in.' },
  auto:    { bonusSeconds: 0,  hullDamage: 0, fuel: 1,
             message: 'Auto-dock burned 1 He2 on the approach.' },
};

/* ── The derelict itself ─────────────────────────────────── */

const DERELICT_LAYOUTS = ['enemy_frigate', 'enemy_gunship', 'enemy_raider'];

/**
 * Build a ship that has clearly been dead for a while: hull holed,
 * systems wrecked, no guns, no power. It is still a normal Ship, so
 * boarding, oxygen, fires and melee all work on it unchanged.
 */
function makeDerelict(sector = 1, worldX = 850, worldY = 120, seedKey = null) {
  const key = seedKey || Utils.pick(DERELICT_LAYOUTS);
  const ship = new Ship(key, false, worldX, worldY);
  ship.isDerelict = true;

  // Dead in the water. EVERY system is off, and nearly all of them are
  // wrecked outright — a derelict is not a ship with the lights down,
  // it is a ship that stopped.
  ship.weapons = [];
  ship.hull = Math.max(1, Math.round(ship.hullMax * Utils.randFloat(0.20, 0.50)));
  ship.systems.forEach(sys => {
    sys.power = 0;
    sys.desiredPower = 0;
    if (sys.type === 'oxygen' || sys.type === 'reactor') return;   // below
    sys.damagedLevels = sys.level;             // shot out, all of it
  });

  /* ONE UNIT OF POWER, ALWAYS — and it goes to the air.
   *
   * A derelict used to be completely cold, with a 70% roll for "her
   * scrubbers are still running" that did nothing whatsoever:
   * Ship.update re-derives every system's power from the reactor budget
   * each frame, and that budget was zero, so `o2.power = 1` was reset to
   * 0 on the very first tick. Every wreck suffocated a boarding party
   * identically, whatever the roll had said.
   *
   * Boarding a wreck is how you hunt the nests, and hunting takes time
   * you cannot spend while the air runs out. So an emergency cell keeps
   * exactly one unit alive, and life support is the only thing drawing
   * on it — everything else is still wrecked.
   */
  const reactorSys = ship.systems.find(sy => sy.type === 'reactor');
  if (ship.reactor) {
    ship.reactor.offline = false;
    ship.reactor.penalty = Math.max(0, ship.reactor.capacity - 1
                                     - (reactorSys ? reactorSys.damagedLevels : 0));
  }

  const o2 = ship.getSystem('oxygen');
  ship.o2Alive = true;
  if (o2) {
    o2.damagedLevels = Math.max(0, o2.level - 1);
    o2.power = 1;
    o2.desiredPower = 1;
  }

  return ship;
}

/* WRECKS DO NOT BURN (update39).
 *
 * `igniteDerelict` used to light 1-3 fires in 45% of hulks. It is gone,
 * not disabled: a wreck has been cold for years, there is one unit of
 * power aboard and it runs the scrubbers, and a fire in a boarding
 * action fought against a clock only ever meant "turn round and go
 * home". The nests are what a wreck is FOR. If fires ever come back,
 * they need a reason to have stayed lit. */

/** Hard ceiling on nests per wreck — one per room, never more than 4. */
const MAX_DERELICT_NESTS = 4;

/** How many spiders are nesting in a sector-N wreck: 1 to 4. */
function derelictSpiderCount(sector = 1) {
  // Was 1..6. Six sacs in a small hulk meant rooms had to double up,
  // and a boarding party of three could not clear them before the air
  // ran out.
  return Utils.clamp(1 + Math.floor(sector / 2) + Utils.randInt(0, 1),
                     1, MAX_DERELICT_NESTS);
}

/**
 * Put the nest into a derelict — as EGG SACS, not as roaming spiders.
 *
 * A wreck should look dead when you dock. The sacs sit in the rooms
 * doing nothing; they split open once your boarding party is aboard
 * (see Ship.hatchNests), which is the moment the place stops being a
 * salvage job and becomes a fight.
 */
function populateDerelict(ship, sector = 1) {
  /* ONE SAC PER ROOM (update38).
   *
   * The old placement was `rooms[i % rooms.length]` over the rooms in
   * hull order: the same room every time for a single sac, and the
   * same room TWICE the moment the count passed the room count. The
   * player found two wrecks running with their one egg in the same
   * module and read it, correctly, as the nest never moving.
   *
   * Shuffle the rooms, take one each, and let the room count cap the
   * nest count — a wreck can never hold more sacs than it has rooms. */
  const withSystems = ship.rooms.filter(r => r.system);
  const rooms = Utils.shuffle((withSystems.length ? withSystems : ship.rooms).slice());
  if (!rooms.length) return [];
  const want    = Math.min(derelictSpiderCount(sector), MAX_DERELICT_NESTS, rooms.length);
  const spiders = makeSpiders(want, Math.min(3, Math.floor(sector / 2)));
  spiders.forEach((sp, i) => {
    const room = rooms[i];
    sp.x = room.cx + Utils.randFloat(-16, 16);
    sp.y = room.cy + 8;
    sp.roomId = room.id;
    sp.homeRoomId = room.id;
    // Dormant, with a stagger so they do not all burst in one frame.
    sp.dormant = true;
    // Nobody knows they are there until somebody walks into the room —
    // Ship.hatchNests flips `revealed` the moment they do.
    sp.revealed = false;
    sp.hatchT  = 2.5 + i * 1.8 + Utils.randFloat(0, 1.5);
    sp._animState = null;
    ship.addCrew(sp, true);
  });
  return spiders;
}

if (typeof window !== 'undefined') {
  window.DockingGame   = DockingGame;
  window.DOCK_OUTCOMES = DOCK_OUTCOMES;
  window.makeDerelict  = makeDerelict;
  window.populateDerelict = populateDerelict;
  window.derelictSpiderCount = derelictSpiderCount;
  window.MAX_DERELICT_NESTS  = MAX_DERELICT_NESTS;
}
