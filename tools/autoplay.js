#!/usr/bin/env node
/* ============================================================
   MOON WARS — tools/autoplay.js  (update259)
   A bot that plays whole contracts through the REAL game in node (tests/harness.js): the base, the launch, the
   sector map, events, fights, loot, ports, the boss, the outcome — every frame stepped, every few frames drawn.
   It is not a good player; it is a stubborn one. What it is for is what a person would only find by playing for a
   day: a throw, a frame that draws NaN, a screen nobody can leave, a man walking on the spot, a fight no one wins.

     node tools/autoplay.js [contracts=12] [seed=1] [--mission=patrol] [--verbose]

   Every contract is played in a fresh engine with Math.random seeded (seed + contract number), so a finding can be
   replayed alone: node tools/autoplay.js 1 <seed of that contract> --mission=<its mission>.
   Writes tools/autoplay-report.json and prints a summary.
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { loadEngine } = require('../tests/harness.js');

const args = process.argv.slice(2);
const N = parseInt(args.find(a => /^\d+$/.test(a)) ?? '12', 10);
const SEED0 = parseInt(args.filter(a => /^\d+$/.test(a))[1] ?? '1', 10);
const ONLY = (args.find(a => a.startsWith('--mission=')) ?? '').split('=')[1] || null;
const VERBOSE = args.includes('--verbose');
/* --strong: a bought hull, better guns and a robot aboard — to reach the later sectors, the bosses, the fighters */
const STRONG = args.includes('--strong') ? 'all' : args.includes('--mixed') ? 'mixed' : null;
const STRONG_HULLS = ['enemy_geb', 'frigate', 'isis', 'osiris'];
const DT = 1 / 30;
const MAX_SIM = parseFloat((args.find(a => a.startsWith('--max=')) ?? '').split('=')[1] || '5400');   // sim seconds a contract
const MISSIONS_CYCLE = ['courier', 'patrol', 'mothership'];   // relief/runners are karma-gated for a new commander

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** One contract, start to outcome. Returns its record. */
function playContract(mission, seed, strong = false) {
  const sb = loadEngine();
  /* one clock for everything, so a seed plays the same game twice */
  let simMs = 1.7e12;
  vm.runInContext('Math.random = __rnd; Date.now = () => __clock(); if (typeof performance !== "undefined") performance.now = () => __clock() - 1.7e12;',
                  Object.assign(sb, { __rnd: mulberry32(seed), __clock: () => simMs }));
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  /* the real game, as near as a harness lets it be */
  if (sb.PATROL) sb.PATROL.on = true;
  if (sb.Ship?.FOE_AWAY) sb.Ship.FOE_AWAY.on = true;
  const { Save, Base, BaseScreen, Game, Input, CombatManager, Fighters, Renderer } = sb;
  const T = Game.__test;
  const rec = { mission, seed, result: 'unfinished', sim: 0, sectors: 0, fights: 0, events: 0, ports: 0, jumps: 0,
                errors: [], stalls: [], nans: [], stuck: [], notes: [], states: {}, end: null, fightLog: [] };
  const err = (where, e) => {
    const key = `${where}: ${e?.message ?? e}`;
    const have = rec.errors.find(x => x.key === key);
    if (have) { have.n++; return; }
    rec.errors.push({ key, n: 1, state: T.STATE, t: +rec.sim.toFixed(1), stack: String(e?.stack ?? '').split('\n').slice(0, 6).join('\n') });
  };
  const log = [];
  const notify = sb.UI.notify;
  sb.UI.notify = function (m, t) { log.push(`[${rec.sim.toFixed(0)}s ${T.STATE}] ${m}`); if (log.length > 400) log.shift(); return notify.apply(sb.UI, arguments); };
  const quiet = (fn) => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };

  /* ── the base: a fresh game, a little money, the contract ── */
  try {
    if (sb.Base?.TANK_GATE) sb.Base.TANK_GATE.on = true;                    // the real gate: no dry launch
    quiet(() => { Save.load(); T._newGame?.(); Base.earn(2500); });
    /* a crew from the barracks and a commander from the mess, as a player has by his second contract */
    quiet(() => { for (let i = 0; i < 4; i++) Base.hireRecruit?.(); });
    const capRes = quiet(() => { const c = Base.crew()[0]; return c ? Base.promote(c.id) : null; });
    if (!capRes?.ok) rec.notes.push(`no commander: ${capRes?.message ?? 'nobody'}`);
    /* her tanks, as a player fills them: the pump for CC */
    quiet(() => { Base.fillShipTanks?.(0, 'he2'); Base.fillShipTanks?.(0, 'air'); });
    quiet(() => BaseScreen.open());
    let shipIdx = 0;
    if (strong) {
      const key = STRONG_HULLS[seed % STRONG_HULLS.length];
      quiet(() => { Base.earn(4000); Base.buyShipSlot?.(); });
      const b = quiet(() => Base.buyShip(key));
      if (b?.ok) { shipIdx = Base.ships().length - 1; quiet(() => { Base.fillShipTanks?.(shipIdx, 'he2'); Base.fillShipTanks?.(shipIdx, 'air'); }); }
      else rec.notes.push(`strong: could not buy ${key}: ${b?.message}`);
      rec.hull = key;
    }
    BaseScreen._set({ mission, shipIdx });
    if (capRes?.ok) BaseScreen._set({ commanderId: capRes.commander.id });
    let r = quiet(() => BaseScreen._act('launch'));
    if (BaseScreen._state().confirm) r = quiet(() => BaseScreen._act('confirmYes'));
    const lo = quiet(() => BaseScreen.consumeLaunch());
    if (!lo || !lo.ok) { rec.result = 'no-launch'; rec.notes.push(`launch refused: ${JSON.stringify(r)} ${lo?.message ?? ''}`); return rec; }
    quiet(() => T._startContract(lo));
  } catch (e) { err('launch', e); rec.result = 'crash-at-launch'; return rec; }
  if (strong && T.playerShip) {
    const P = T.playerShip;
    const guns = ['laser_burst', 'missile_basic', 'laser_heavy'];
    for (let i = 0; i < (P.weaponSlots ?? P.weapons.length ?? 1); i++) { try { quiet(() => P.installWeapon(guns[i % guns.length], i)); } catch (e) { err('strong: install', e); } }
    try { P.weapons.forEach((w, i) => { const sys = w && P.weaponSystemFor?.(i); if (sys) { sys.level = Math.max(sys.level, w.powerCost); } }); P.reactor.level = Math.min(P.reactor.maxLevel, P.reactor.level + 4); quiet(() => P._allocateDefaultPower()); } catch (e) { err('strong: power', e); }
    if (sb.Robots) { const kinds = ['repair', 'operator', 'combat'], races = ['aquarius', 'phoenix', 'terra', 'pegasus']; const bot = sb.Robots.make(races[seed % 4], kinds[seed % 3]); P.addCrew(bot); const room = P.rooms.find(r => r.type === 'engines') ?? P.rooms[0]; bot.roomId = room.id; bot.homeRoomId = room.id; [bot.x, bot.y] = P.stationSlot(room, 1); }
  }
  const crew0 = T.playerShip?.crew?.length ?? 0;
  rec.commander = !!T.commander;
  /* which screen opened the loot window, for a stall report */
  let lastLoot = null;
  for (const k of ['openLoot', 'openHold']) {
    const real = sb.LootScreen[k];
    sb.LootScreen[k] = function (...a) {
      const o = a.find(x => x && typeof x === 'object' && !x.items && ('onClose' in x || 'doneLabel' in x || 'title' in x)) ?? {};
      lastLoot = { k, state: T.STATE, title: o.title ?? null, done: o.doneLabel ?? null, timed: o.seconds ?? o.timer ?? null, from: String(new Error().stack).split('\n')[2]?.trim() };
      return real.apply(this, a);
    };
  }
  const shipsBefore = Base.ships?.().length ?? 0;      // the launched hull is checked out of the hangar

  /* ── input, per frame ── */
  let keys = new Set();
  const realPressed = Input.isPressed;
  Input.isPressed = (code) => keys.has(code);
  const press = (...k) => k.forEach(x => keys.add(x));
  const click = (x, y) => { Input.mouse.x = x; Input.mouse.y = y; Input.mouse.leftPressed = true; };

  let stateT = 0, lastState = null, mapWait = 0, refusals = 0, lastHull = null, sameEvent = 0, lastEvent = null;
  let fightT = 0, ctx = null;
  try { Renderer.init(sb.document.createElement('canvas')); ctx = Renderer.getCtx(); } catch (e) { ctx = null; err('renderer init', e); }
  const watchPos = new Map();     // crew id → { x, y, t }

  const frames = Math.ceil(MAX_SIM / DT);
  for (let f = 0; f < frames; f++) {
    rec.sim += DT; simMs += DT * 1000;
    keys = new Set();
    Input.mouse.leftPressed = false;
    const S = T.STATE;
    rec.states[S] = (rec.states[S] ?? 0) + DT;
    if (S !== lastState) {
      if (lastState === 'combat' && rec._fight) { rec._fight.secs = +(rec.sim - rec._fight.t0).toFixed(1); rec._fight.end = CombatManager.state; rec._fight.foeHull = T.enemyShip?.hull ?? null; rec._fight.hull = T.playerShip?.hull; rec.fightLog.push(rec._fight); rec._fight = null; }
      if (S === 'combat') rec._fight = { t0: rec.sim, foe: T.enemyShip?.layoutKey ?? null, foeHull0: T.enemyShip?.hull ?? null, hull0: T.playerShip?.hull };
      stateT = 0; lastState = S;
    } else stateT += DT;

    /* ── the bot's hands ── */
    try {
      if (sb.JumpScene?.active?.()) press('Space');
      else if (S === 'map') {
        T.paused = false;
        if (T.eventResult) T.eventResult = null;
        const map = T.sectorMap;
        mapWait += DT;
        const P0 = T.playerShip;
        if (Fighters && P0 && Fighters.away(P0).length) Fighters.away(P0).forEach(sys => quiet(() => Fighters.order(P0, sys, 'recall')));
        if (map && mapWait > 2.5) {
          mapWait = 0;
          const opts = map.awaitingStartPick ? map.startNodes : map.reachable();
          if (!opts.length) { rec.stalls.push({ t: rec.sim, what: 'map: no reachable node', node: map.currentId }); break; }
          /* low on hull: a port if there is one */
          const hullFrac = T.playerShip ? T.playerShip.hull / T.playerShip.hullMax : 1;
          const port = opts.find(n => n.type === 'store');
          const pick = hullFrac < 0.5 && port ? port : opts[Math.floor(rnd() * opts.length)];
          const before = map.currentId;
          quiet(() => T._travelTo(pick.id));
          if (map.currentId === before && !map.awaitingStartPick) {
            refusals++;
            /* what a player does about it: a hand to the helm, a hand to the engines */
            const last = log.slice(-3).join(' ');
            const P = T.playerShip;
            const sendTo = (type) => {
              const room = P?.rooms.find(r => r.type === type);
              const there = P?.crew.some(c => c.alive && c.roomId === room?.id && !c.isPet);
              const hand = P?.crew.find(c => c.alive && !c.isPet && !c.isPassenger && !c.isPrisoner && c.roomId !== room?.id);
              if (room && hand && !there) { hand.homeRoomId = room.id; hand.moveToOnShip(P, ...P.stationSlot(room, 0)); rec.notes.push(`bot: sent ${hand.name} to the ${type}`); }
            };
            const power = (type) => { const sys = P?.getSystem?.(type); if (sys && P.setPower) { P.setPower(type, sys.level); rec.notes.push(`bot: power to ${type}`); } };
            if (/helm|cockpit/i.test(last)) { if (/power/i.test(last)) power('piloting'); else sendTo('piloting'); }
            if (/engine/i.test(last)) { if (/power/i.test(last)) power('engines'); else sendTo('engines'); }
            if (refusals === 1 || refusals % 20 === 0) rec.notes.push(`jump refused x${refusals}: ${log.slice(-1)[0] ?? ''}`);
            if (refusals > 60) {
              const P1 = T.playerShip;
              const pw = P1 ? { reactor: P1.reactor.level, free: P1.reactor.available?.() ?? P1.availablePower?.() ?? null, heat: P1.reactor.heat ?? null, penalty: P1.reactor.penalty ?? 0,
                                sys: P1.systems.map(x => `${x.type}:${x.level}/${x.power}/${x.desiredPower ?? '-'}${x.isDisabled?.() ? ' DIS' : ''} w${x.workingLevels}`).join(' '),
                                crew: P1.crew.map(c => `${c.name}${c.isRobot ? '(R)' : ''}:${c.dead ? 'dead' : c.state}@${P1.getRoomById(c.roomId)?.type ?? c.roomId}→${P1.getRoomById(c.homeRoomId)?.type ?? c.homeRoomId} ${c.task} hp${Math.round(c.hp)}${c.isRobot ? ' e' + Math.round(c.energy) : ''}`).join(', '),
                                breaches: P1.breaches?.length ?? null, fires: P1.fires?.length ?? null } : null;
              /* the men who are walking: where they are, where they go, for two seconds */
              const movers = (P1?.crew ?? []).filter(c => !c.dead && (c._waypoints?.length ?? 0) > 0);
              const trace = movers.map(c => ({ name: c.name, from: [Math.round(c.x), Math.round(c.y)], room: c.roomId, wp: c._waypoints.slice(0, 4).map(w => (w && typeof w === 'object') ? Object.fromEntries(Object.entries(w).filter(([k, v]) => typeof v !== 'object').map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])) : w) }));
              for (let k = 0; k < 60; k++) { try { T._step(DT); } catch (e) {} }
              movers.forEach((c, k) => { trace[k].to = [Math.round(c.x), Math.round(c.y)]; trace[k].room2 = c.roomId; trace[k].wp2 = c._waypoints.length; });
              rec.stalls.push({ t: rec.sim, what: 'map: cannot jump for 150 s', last: log.slice(-3), power: pw, movers: trace }); break;
            }
          } else { refusals = 0; rec.jumps++; }
        }
      } else if (S === 'event') {
        const ev = T.event;
        if (!ev) { if (stateT > 3) { rec.stalls.push({ t: rec.sim, what: 'event state with no event' }); break; } }
        else if (stateT > 0.4) {
          if (ev === lastEvent) sameEvent++; else { sameEvent = 0; lastEvent = ev; rec.events++; }
          if (sameEvent > 12) { rec.stalls.push({ t: rec.sim, what: `event will not resolve: ${ev.title}`, choices: ev.choices?.map(c => c.label) }); break; }
          else {
            const n = ev.choices?.length ?? 0;
            const ok = (ev.choices ?? []).map((c, i) => i).filter(i => !ev.choices[i].disabled && !ev.choices[i].locked);
            let i = ok.length ? ok[Math.floor(rnd() * ok.length)] : Math.floor(rnd() * Math.max(1, n));
            /* the Lunar Patrol: most of the time a player does what she says */
            const tame = (ev.choices ?? []).findIndex(c => /comply|submit|pay|allow|let them|accept|stand down|open|yes/i.test(c.label ?? ''));
            if (/patrol|customs/i.test(ev.title ?? '') && tame >= 0 && rnd() < 0.75) i = tame;
            quiet(() => T._resolveEvent(i));
            stateT = 0;
          }
        }
      } else if (S === 'combat') {
        fightT += DT;
        const P = T.playerShip, E = T.enemyShip;
        if (stateT < DT * 1.5) rec.fights++;
        /* won: bring her fighter home, give the crew a moment, JUMP */
        if (CombatManager.isVictory?.()) {
          const away = Fighters ? Fighters.away(P) : [];
          away.forEach(sys => quiet(() => Fighters.order(P, sys, 'recall')));
          rec._winT = (rec._winT ?? 0) + DT;
          if (rec._winT > 3 && !away.length) press('Enter');
          if (rec._winT > 120) { rec.stalls.push({ t: rec.sim, what: 'won, but cannot leave the fight in 2 min', away: away.length, last: log.slice(-3) }); break; }
        } else rec._winT = 0;
        if (P && E && !E.destroyed) {
          const aim = E.rooms.find(r => r.type === 'weapons') ?? E.rooms.find(r => r.type === 'shields') ?? E.rooms[0];
          P.weapons.forEach(w => { if (w) { w.autoFire = true; if (!w.targetRoom || !E.rooms.includes(w.targetRoom)) w.targetRoom = aim; } });
          /* her fighter on orders */
          if (Fighters && (f % 90) === 0) Fighters.hangars(P).forEach(sys => {
            const fi = Fighters.of(sys);
            if (fi.state === 'docked' && !fi.pilot) {
              const hand = P.crew.find(c => c.alive && !c.isPet && c.roomId !== sys.roomId && !c._boardFighter && c.homeRoomId !== sys.roomId);
              if (hand) { hand._boardFighter = sys.roomId; hand.homeRoomId = sys.roomId; const room = P.getRoomById(sys.roomId); hand.moveToOnShip(P, ...P.stationSlot(room, 1)); }
            }
            quiet(() => Fighters.order(P, sys, 'launch', true, E));
          });
          /* run when it goes badly */
          if (P.hull / P.hullMax < 0.2 && (f % 60) === 0 && !sb.BossManager?.isActive) press('KeyR');
        }
        if (fightT > 600 && stateT > 600) { rec.stalls.push({ t: rec.sim, what: 'a fight past 10 minutes', hull: [P?.hull, E?.hull], enemy: E?.layoutKey }); break; }
      } else if (S === 'loot') {
        /* TAKE ALL (left of the row) is not the bot's business: DONE, bottom right (lootscreen.js, y 588) */
        if (stateT > 0.6 && (f % 15) === 0) click(1100, 605);
        if (stateT > 2.5 && (f % 15) === 7) press('Escape');
        if (stateT > 12) { rec.stalls.push({ t: rec.sim, what: 'loot screen will not close', opened: lastLoot, open: sb.LootScreen.isOpen?.(), last: log.slice(-3) }); break; }
      } else if (S === 'station') {
        if (stateT > 0.8) {
          const st = T.station, run = Save.getRun(), P = T.playerShip;
          if (st && P && run && !rec._portDone) {
            rec._portDone = true; rec.ports++;
            quiet(() => { try { const miss = P.hullMax - P.hull; if (miss > 0) st.buyHullRepair(Math.min(miss, Math.floor(run.scrap / 3)), P); } catch (e) { err('port repair', e); } });
          }
          quiet(() => T._leavePort());
        }
        if (stateT > 10) { rec.stalls.push({ t: rec.sim, what: 'port will not let go' }); break; }
      } else if (S === 'prison') {
        if (stateT > 1) quiet(() => T._leavePrison?.());
        if (stateT > 10) { rec.stalls.push({ t: rec.sim, what: 'prison will not let go' }); break; }
      } else if (S === 'docking') {
        if (stateT > 0.5) press('Escape');
        if (stateT > 20) { rec.stalls.push({ t: rec.sim, what: 'docking minigame will not end' }); break; }
      } else if (S === 'promo') {
        if (stateT > 0.3 && (f % 10) === 0) { const o = T._promoRects?.()?.opts?.[0]; if (o) click(o.x + 2, o.y + 2); }
        if (stateT > 6) { rec.stalls.push({ t: rec.sim, what: 'promotion screen will not close' }); break; }
      } else if (S === 'dismiss') {
        if (stateT > 0.5) press('Enter');
      } else if (S === 'outcome') {
        rec.end = rec.end ?? { hull: T.playerShip?.hull, crew: T.playerShip?.crew?.filter(c => !c.dead).length, sector: Save.getRun()?.sector };
        if (stateT > 1.3) press('Enter');
      } else if (S === 'base' || S === 'menu') {
        break;
      } else if (S === 'landing') {
        if (stateT > 30) { rec.stalls.push({ t: rec.sim, what: 'landing never ends' }); break; }
      }
      if (S !== 'combat') fightT = 0;
    } catch (e) { err(`bot@${S}`, e); }

    /* ── the game ── */
    try { T._step(DT); } catch (e) { err(`step@${S}`, e); }
    if (ctx && (f % 6) === 0) { try { quiet(() => T._draw()); } catch (e) { err(`draw@${T.STATE}`, e); } }

    /* ── what a person would notice ── */
    if ((f % 30) === 0) {
      const P = T.playerShip;
      const run = Save.getRun?.();
      if (run) rec.sectors = Math.max(rec.sectors, run.sector ?? 0);
      const bad = (v) => typeof v === 'number' && !Number.isFinite(v);
      if (P) {
        if (bad(P.hull)) rec.nans.push({ t: rec.sim, what: 'player hull', v: P.hull });
        P.crew.forEach(c => {
          if (bad(c.hp) || bad(c.x) || bad(c.y) || bad(c.air) || bad(c.hunger) || (c.isRobot && bad(c.energy))) rec.nans.push({ t: rec.sim, what: `crew ${c.name}`, hp: c.hp, x: c.x, y: c.y, air: c.air });
          /* walking on the spot */
          if (!c.dead && !c.down && (c._waypoints?.length ?? 0) > 0) {
            const w = watchPos.get(c.id);
            if (!w || Math.hypot(w.x - c.x, w.y - c.y) > 2) watchPos.set(c.id, { x: c.x, y: c.y, t: rec.sim });
            else if (rec.sim - w.t > 25 && !w.flagged && ['map', 'combat'].includes(T.STATE)) {
              w.flagged = true;
              /* the lift he waits for, frame by frame */
              if (args.includes('--probe-lift')) {
                const sh = P.elevators?.shafts ?? [];
                rec.liftProbe = [];
                for (let k = 0; k < 45; k++) { try { T._step(DT); } catch (e) {} rec.liftProbe.push(sh.map(x => `${x.powered ? 'P' : 'd'}${x._moving ? 'M' : 's'}${Math.round(x._cabinY)}`).join(',') + ` spare${Math.round((P.reactor?.available?.() ?? -1) * 10) / 10}`); }
              }
              rec.stuck.push({ t: +rec.sim.toFixed(0), state: T.STATE, name: c.name, room: c.roomId, home: c.homeRoomId, wp: c._waypoints.length, task: c.task, robot: !!c.isRobot,
                               at: [Math.round(c.x), Math.round(c.y)], st: c.state, hp: Math.round(c.hp), carrying: !!c.carrying, busy: c._busyAct ?? null, stun: c._stunT ?? null,
                               next: c._waypoints.slice(0, 3).map(w => (w && typeof w === 'object') ? Object.fromEntries(Object.entries(w).filter(([k, v]) => typeof v !== 'object').map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])) : w),
                               lifts: (P.elevators?.shafts ?? []).map(sh => `${Math.round(sh.x)}:${sh.damaged ? 'BROKEN' : sh.powered === false ? 'DARK' : 'ok'}`).join(' '), spare: P.reactor?.available?.() ?? null,
                               shaft: (P.elevators?.shafts ?? []).map(sh => Object.fromEntries(Object.entries(sh).filter(([k, v]) => v == null || typeof v !== 'object' || Array.isArray(v)).map(([k, v]) => [k, Array.isArray(v) ? v.map(q => q?.name ?? q?.id ?? (typeof q === 'object' ? Object.keys(q).join('/') : q)) : (typeof v === 'number' ? Math.round(v) : v)]))),
                               doors: (P.doors ?? []).filter(d => d.roomA === c.roomId || d.roomB === c.roomId || d.a === c.roomId || d.b === c.roomId).map(d => `${d.roomA ?? d.a}-${d.roomB ?? d.b}:${d.state ?? (d.open ? 'open' : 'shut')}${d.locked ? ' LOCK' : ''}`) });
            }
          } else watchPos.delete(c.id);
        });
        if (run && (bad(run.scrap) || bad(run.fuel))) rec.nans.push({ t: rec.sim, what: 'run purse/fuel', scrap: run.scrap, fuel: run.fuel });
      }
      const E = T.enemyShip;
      if (E && bad(E.hull)) rec.nans.push({ t: rec.sim, what: 'enemy hull', v: E.hull });
    }
    if (rec.errors.length > 40) { rec.notes.push('too many errors — stopped'); break; }
  }
  Input.isPressed = realPressed;
  /* how it ended */
  const S = T.STATE;
  if (S === 'base' || S === 'menu') {
    rec.result = (Base.ships?.().length ?? 0) > shipsBefore ? 'won' : 'lost';
  } else rec.result = `stopped in ${S}`;
  rec.crewStart = crew0;
  rec.log = log.slice(-12);
  if (args.includes('--fulllog')) rec.fullLog = log.slice();
  delete rec._portDone; delete rec._winT; delete rec._fight;
  return rec;
}

/* ── the run ── */
const out = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const mission = ONLY ?? MISSIONS_CYCLE[i % MISSIONS_CYCLE.length];
  const EXACT = (args.find(a => a.startsWith('--seed=')) ?? '').split('=')[1];
  const seed = EXACT ? parseInt(EXACT, 10) + i : SEED0 * 1000 + i;
  let r;
  const strong = STRONG === 'all' || (STRONG === 'mixed' && i % 2 === 1);
  try { r = playContract(mission, seed, strong); if (strong) r.strong = true; }
  catch (e) { r = { mission, seed, result: 'harness-crash', errors: [{ key: e.message, stack: e.stack }] }; }
  out.push(r);
  const line = `#${i + 1} ${mission.padEnd(10)}${strong ? '*' : ' '}seed ${seed}: ${String(r.result).padEnd(18)} sim ${Math.round(r.sim ?? 0)}s, sectors ${r.sectors}, fights ${r.fights}, events ${r.events}, ports ${r.ports}` +
               `${r.errors?.length ? `, ERRORS ${r.errors.length}` : ''}${r.stalls?.length ? `, STALLS ${r.stalls.length}` : ''}${r.nans?.length ? `, NaN ${r.nans.length}` : ''}${r.stuck?.length ? `, STUCK ${r.stuck.length}` : ''}`;
  console.log(line);
  if (VERBOSE) { (r.errors ?? []).forEach(e => console.log('   ERR', e.key, `x${e.n}`, `\n${e.stack}`)); (r.stalls ?? []).forEach(s => console.log('   STALL', JSON.stringify(s))); }
}
const sum = {
  contracts: out.length, minutes: +((Date.now() - t0) / 60000).toFixed(1),
  won: out.filter(r => r.result === 'won').length, lost: out.filter(r => r.result === 'lost').length,
  other: out.filter(r => !['won', 'lost'].includes(r.result)).map(r => `${r.mission}/${r.seed}: ${r.result}`),
  errors: [...new Set(out.flatMap(r => (r.errors ?? []).map(e => e.key)))],
  stalls: out.flatMap(r => (r.stalls ?? []).map(s => `${r.mission}/${r.seed}: ${s.what}`)),
  stuck: out.flatMap(r => (r.stuck ?? []).map(s => `${r.mission}/${r.seed}: ${s.name} ${s.state} room ${s.room} → ${s.home} task ${s.task}${s.robot ? ' (robot)' : ''}`)),
  nans: out.flatMap(r => (r.nans ?? []).map(s => `${r.mission}/${r.seed}: ${s.what}`)),
};
fs.writeFileSync(path.join(__dirname, 'autoplay-report.json'), JSON.stringify({ sum, runs: out }, null, 1));
console.log('\n' + JSON.stringify(sum, null, 1));
