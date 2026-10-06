/* ============================================================
   MOON WARS — commander.js  (update43)

   THE COMMANDER IS NOT A MAN ON THE DECK.

   He has no HP, no walk cycle, no console and no boarding orders. He
   cannot be shot, burned or vented. He belongs to the EXPEDITION, not
   to a compartment — which is exactly why he is a separate record and
   not another CrewMember: `ship.crew` is the list of bodies aboard, and
   every filter in the game reads it that way.

   What he does:
     · mirrors his crew's XP — every point a crewman is actually
       granted is copied to the commander, never taken from him;
     · grows to level 24, one point a level in four attributes
       (update98): KNOWLEDGE (the pool every order is paid from),
       INTELLIGENCE (tablets, update B), LEADERSHIP and ENDURANCE
       (both reach crew of HIS OWN corporation, and nobody else);
     · pays for every order out of that knowledge pool (update98) —
       routine ones as often as it lasts, special ones once a fight;
     · carries a karma reading (0 = ruthless, 100 = principled) that
       moves the wall on his CPU board.

   He dies with the ship or with the last of his people, unless an
   escape pod gets him out first (update44). Losing him costs the
   levels, not the base.
   ============================================================ */

'use strict';

/** Rank 24 — Master Lord — is the ceiling, and it is the SAME ladder
 *  the crew climb (RANKS in crew.js). One cell of the CPU board opens
 *  per level, and the board is 5x5, so 24 levels plus the rank he is
 *  promoted at is exactly 25 cells. Do NOT raise this without giving
 *  those levels somewhere to go. */
const COMMANDER_MAX_LEVEL = (typeof MAX_RANK !== 'undefined') ? MAX_RANK : 24;

/* XP to go from level N to N+1, for all 24 steps.
 *
 * update51 doubled crew XP and update52 stretched the ladder from 8
 * levels to 24, so the old seven-entry table is gone. This is a curve,
 * not a list of hand-picked numbers, precisely because 24 hand-picked
 * numbers would be 24 chances to fat-finger one: cost(n) = 120 * n^1.6,
 * rounded to the nearest 10. That is ~120 XP for the first step (a
 * fraction of one fight at update51 rates) and ~19k for the last, with
 * about 145k to climb the whole thing from Recruit.
 *
 * A commander promoted from a rank-N crewman STARTS at level N, so
 * nobody actually pays the bottom of this curve twice. */
const COMMANDER_LEVEL_XP = (() => {
  const out = [];
  for (let n = 1; n <= 24; n++) out.push(Math.round(120 * Math.pow(n, 1.6) / 10) * 10);
  return out;
})();

/* ── WHAT A PROMOTION COSTS (update52) ───────────────────────
 *
 * Exponential in the crewman's RANK, because that rank is exactly what
 * the commander keeps: promote a Master Lord and you get a level 24
 * commander with 25 open cells on day one. The whole ladder in one
 * formula rather than a table, for the same reason as the XP curve.
 *
 *   80 * 1.20^rank, rounded to 10
 *
 * Recruit 80 CC, Corporal ~170, Captain ~1230, Master Lord ~6360.
 * update51's flat 100/150/250/400 tier prices are GONE — that whole
 * system is replaced, not stacked on top of. */
function commanderPrice(rankLevel) {
  const n = Utils.clamp(rankLevel ?? 0, 0, COMMANDER_MAX_LEVEL);
  return Math.round(80 * Math.pow(1.20, n) / 10) * 10;
}

/* ── FOUR ATTRIBUTES INSTEAD OF A CORPORATION PICK (update98) ──
 *
 * update52's "+0.5% in one of two trades per level" is GONE, not
 * stacked on: every level now buys ONE POINT in one of four
 * attributes, and the corporation no longer decides which. jj's
 * design (projekt-kapitan-wiedza-tabliczki, 04.10):
 *
 *   KNOWLEDGE    — the pool every order and every tablet is paid from:
 *                  max = 10 + 5 per point;
 *   INTELLIGENCE — how high a tablet he can read (update B);
 *   LEADERSHIP   — his own corporation moves and repairs faster;
 *   ENDURANCE    — his own corporation carry more air and more HP.
 *
 * Levels not spent are `level - pointsSpent`, computed — exactly the
 * rule the picks had, so a promotion from rank N still owes N points
 * at once and nothing can accrue in a counter somebody forgot.
 */
const COMMANDER_ATTRS = ['knowledge', 'intelligence', 'leadership', 'endurance'];

const COMMANDER_ATTR_LABEL = {
  knowledge:    'KNOWLEDGE',
  intelligence: 'INTELLIGENCE',
  leadership:   'LEADERSHIP',
  endurance:    'ENDURANCE',
};

/** The knowledge pool: a base and so much per KNOWLEDGE point. */
const KNOWLEDGE_BASE      = 10;
const KNOWLEDGE_PER_POINT = 5;
/** What comes back after a fight, as a share of the pool. In port and
 *  at base it comes back to full. During a fight it does not grow. */
const KNOWLEDGE_AFTER_FIGHT = 0.30;

/* LEADERSHIP — HIS OWN PEOPLE ONLY. +1% move and +1% repair a point,
   and four steps on the way that each add one trade: the table is the
   whole rule, so the dossier and the crew read the same numbers. */
const LEADERSHIP_PER_POINT = 0.01;
const LEADERSHIP_STEPS = [
  { at: 3, effect: 'firefight', value: 0.05 },
  { at: 5, effect: 'breach',    value: 0.05 },
  { at: 7, effect: 'speed',     value: 0.05 },
  { at: 9, effect: 'repair',    value: 0.05 },
];

/* ENDURANCE — HIS OWN PEOPLE ONLY. The commander has no body (jj: he
   does not faint and has no HP), so what he gives is to the crew: a
   longer suit bottle and a few more hit points each. */
const ENDURANCE_AIR_PER_POINT = 0.05;   // +5% of the suit tank
const ENDURANCE_HP_PER_POINT  = 5;      // +5 max HP, flat

/* ── WHAT AN ORDER COSTS (update98) ──────────────────────────
 *
 * EVERY order is paid in knowledge now — jj: "Knowledge schodzi przy
 * każdym rozkazie". Two kinds:
 *   · ROUTINE orders (the left panel): as often as the pool allows,
 *     1 each, BOARD 5 — sending men across is the expensive one;
 *   · SPECIAL orders (one per mastered trade): once per fight AND a
 *     cost — timed 5-8, instant 8-12 (see `cost` on each below).
 * One table for the routine ones, the cost on the def for the special
 * ones, and ONE reader of both (`orderCost`). */
const ROUTINE_ORDERS = {
  save:       { key: 'save',       label: 'SAVE POSITIONS',     cost: 1 },
  return:     { key: 'return',     label: 'RETURN TO STATIONS', cost: 1 },
  doorsOpen:  { key: 'doorsOpen',  label: 'OPEN ALL',           cost: 1 },
  doorsClose: { key: 'doorsClose', label: 'CLOSE ALL',          cost: 1 },
  board:      { key: 'board',      label: 'BOARDING',           cost: 5 },
  recall:     { key: 'recall',     label: 'RECALL',             cost: 1 },
};

/* ── THE EIGHT SPECIAL ORDERS (update53) ─────────────────────
 *
 * A crewman who MASTERED a skill before he took the chair brings that
 * trade onto the bridge with him: one order only a commander who has
 * done the job himself knows how to give. Eight skills, eight orders,
 * and `specialties` on his record (written at promotion in update52)
 * is the whole of what decides which he has.
 *
 * ONCE PER FIGHT, each — and since update98 each also COSTS knowledge
 * (`cost`), on top of the once. That was JJ's call over a cooldown, and it is
 * the better rule: an order you can only give once is a decision about
 * WHEN, which is what an order should be. A cooldown would make it a
 * question of clicking often enough.
 *
 * `hold` is how many seconds the effect lasts; 0 means it happens at
 * once and is over. `effect` names the buff `orderBonus()` publishes —
 * an instant order has none, because it changes the ship directly.
 */
const COMMANDER_ORDERS = {
  piloting: {
    key: 'piloting', cost: 6, label: 'EVASIVE PATTERN', glyph: '\u2941',
    hold: 8, effect: 'evasion', value: 0.25,
    desc: '+25% evasion for 8 s. The helm stops flying the course and starts flying the guns.',
  },
  engines: {
    key: 'engines', cost: 7, label: 'FLANK SPEED', glyph: '\u00bb',
    hold: 8, effect: 'jump', value: 1,
    /* TWO EFFECTS, ONE CLOCK. It buys evasion AND a double-speed jump,
       and both have to end together — so it publishes one effect
       (`jump`) and `orderBonus('evasion')` folds it in below. Two
       separate clocks for one order is two clocks to get wrong. */
    alsoEvasion: 0.15,
    desc: '+15% evasion for 8 s and the jump spools at double speed. Everything the drive has.',
  },
  weapons: {
    key: 'weapons', cost: 12, label: 'FULL SALVO', glyph: '\u2739',
    hold: 0,
    desc: 'Every mounted gun charges instantly. Once.',
  },
  shields: {
    key: 'shields', cost: 10, label: 'EMERGENCY BUBBLE', glyph: '\u25cb',
    hold: 0,
    desc: 'The bubble comes back to full, now, whatever the charge was.',
  },
  repair: {
    key: 'repair', cost: 10, label: 'DAMAGE CONTROL', glyph: '\u2692',
    hold: 0,
    desc: 'Every damaged system gets one level back at once.',
  },
  firefight: {
    key: 'firefight', cost: 8, label: 'FIRE SUPPRESSION', glyph: '\u2668',
    hold: 0,
    desc: 'Every fire aboard is out. It does not stop new ones.',
  },
  breach: {
    key: 'breach', cost: 8, label: 'HULL SEAL', glyph: '\u25a3',
    hold: 0,
    desc: 'Every hull breach aboard is sealed. The air still has to come back.',
  },
  combat: {
    key: 'combat', cost: 5, label: 'BATTLE FURY', glyph: '\u2694',
    hold: 10, effect: 'melee', value: 0.5,
    desc: '+50% melee damage to your crew for 10 s. Boarders included.',
  },
};

const Commander = (() => {

  /* The commander currently flying. ONE reference to the run's own
     record — not a copy — so nothing can drift out of step with it. */
  let _active = null;

  /* ── ORDERS IN FLIGHT (update53) ──────────────────────────
   *
   * Seconds remaining on each RUNNING ORDER, by its own key — not by
   * effect. What one effect is worth right now is a question, and it
   * is answered in ONE place (`orderBonus`) by looking at what is
   * running. That matters because an order can pay into more than one
   * effect — FLANK SPEED buys evasion AND a faster jump — and because
   * two orders may one day pay into the same one. Storing a merged
   * per-effect number instead would need the merge done at write time,
   * in a branch nothing can reach until such a pair exists, which is
   * the worst kind of code: unreachable, untestable, and confidently
   * commented.
   *
   * It lives here, beside `_active`, because this is where every other
   * "what is the boss worth right now" question is already answered. */
  let _orderT = {};              // order key -> seconds left
  let _orderUsed = {};           // order key -> true, for THIS fight

  // ── Records ───────────────────────────────────────────────

  /**
   * Promote a serialised crew record into a commander.
   * The man LEAVES the barracks: no copy is made, and there is no way
   * back. His service record travels with him because the memorial
   * still wants it; his skills come along as history and grant nothing.
   */
  function fromCrew(rec) {
    if (!rec) return null;
    /* HE KEEPS WHAT HE EARNED. A rank-12 crewman becomes a level-12
       commander with twelve cells already open — that is the whole
       deal, and it is why a good hand is expensive. */
    const lvl = Math.max(1, rankLevelOf(rec));
    return migrate({
      id:      rec.id || Utils.uid(),
      name:    rec.name || 'Commander',
      race:    rec.race || 'terra',
      level:   lvl,
      xp:      0,
      karma:   50,                       // 0 = ruthless … 100 = principled
      battles: rec.battles ?? 0,
      wins:    rec.wins    ?? 0,
      escapes: rec.escapes ?? 0,
      kills:   rec.kills   ?? 0,
      pastSkills: Utils.deepClone(rec.skills || {}),   // history, not power
      chips:   [],                       // update44

      /* THE SKILLS HE MASTERED, kept as a list (update52). update53
         turns each of these into a special ORDER only this commander
         can give — the reason to spend a specialist rather than the
         cheapest warm body. Written once, here; his `pastSkills` sheet
         stays as the memorial record it always was. */
      specialties: masteredOf(rec),

      /* WHAT HE HAS SPENT HIS LEVELS ON (update98): one point per
         level in one of four attributes. Levels not yet spent are
         `level - pointsSpent`, computed — a rank-12 man arrives owing
         twelve. The knowledge pool starts full (`knowledge` is filled
         in by `migrate` below, the one place that knows its size). */
      attrs:   { knowledge: 0, intelligence: 0, leadership: 0, endurance: 0 },

      away:    false,                    // out on a contract right now
    });
  }

  /** What promoting THIS crew record costs today, in CC. */
  function priceFor(rec) { return commanderPrice(rankLevelOf(rec)); }

  /* ── ATTRIBUTES (update98) ────────────────────────────────
   *
   * MIGRATE ONCE, IN ONE PLACE. A record from before update98 carries
   * `picks` (+0.5% trades) and no `attrs`. jj's rule: the old picks
   * turn back into points — every level he has is owed again, and the
   * promotion screen hands them out. The picks themselves are DELETED,
   * not kept beside the attributes: two registers for one commander's
   * levels is the bug this project keeps having.
   *
   * Idempotent, and called wherever a record enters the game (the
   * mess, the chair, a rolled enemy) so nothing downstream ever has to
   * ask "is this an old one".
   */
  function migrate(cap) {
    if (!cap) return cap;
    if (!cap.attrs || typeof cap.attrs !== 'object') cap.attrs = {};
    COMMANDER_ATTRS.forEach(k => {
      const v = cap.attrs[k];
      cap.attrs[k] = (typeof v === 'number' && v > 0) ? Math.floor(v) : 0;
    });
    if ('picks' in cap) delete cap.picks;
    if (typeof cap.knowledge !== 'number' || !isFinite(cap.knowledge)) {
      cap.knowledge = knowledgeMax(cap);
    }
    cap.knowledge = Utils.clamp(cap.knowledge, 0, knowledgeMax(cap));
    return cap;
  }

  /** One attribute's points. */
  function attr(cap, k) { return cap?.attrs?.[k] || 0; }

  /** How many points he has already spent. */
  function pointsSpent(cap) {
    return COMMANDER_ATTRS.reduce((a, k) => a + attr(cap, k), 0);
  }

  /** How many are owed to the player right now — promotion included. */
  function pointsOwed(cap) {
    if (!cap) return 0;
    return Math.max(0, Utils.clamp(cap.level, 0, COMMANDER_MAX_LEVEL) - pointsSpent(cap));
  }

  /**
   * Spend ONE owed point. Returns true if it was spent.
   * Refuses an attribute that does not exist and a level he has not
   * reached — the two ways this could become free power.
   * A KNOWLEDGE point grows the pool AND fills the new room: the five
   * he just bought are his to use, not an empty bar to wait on.
   */
  function spendPoint(cap, k) {
    if (!cap || pointsOwed(cap) <= 0) return false;
    if (!COMMANDER_ATTRS.includes(k)) return false;
    migrate(cap);
    cap.attrs[k] += 1;
    if (k === 'knowledge') cap.knowledge = Math.min(knowledgeMax(cap), cap.knowledge + KNOWLEDGE_PER_POINT);
    return true;
  }

  /* ── KNOWLEDGE (update98) ── */

  /** The size of his pool. */
  function knowledgeMax(cap) {
    return KNOWLEDGE_BASE + KNOWLEDGE_PER_POINT * attr(cap, 'knowledge');
  }

  /** What is in it now. */
  function knowledge(cap) {
    if (!cap) return 0;
    const k = cap.knowledge;
    return (typeof k === 'number') ? Utils.clamp(k, 0, knowledgeMax(cap)) : knowledgeMax(cap);
  }

  /** Take `n` out. Returns false (and takes nothing) when he has less. */
  function spendKnowledge(cap, n) {
    if (!cap || !(n >= 0)) return false;
    const have = knowledge(cap);
    if (have < n) return false;
    cap.knowledge = have - n;
    return true;
  }

  /**
   * Put some back: a share of the POOL, not of what was spent, capped
   * at full. `frac = 1` is the port and the base. Returns what came back.
   */
  function refillKnowledge(cap, frac = 1) {
    if (!cap) return 0;
    const max = knowledgeMax(cap), have = knowledge(cap);
    const to = Math.min(max, have + Math.ceil(max * Utils.clamp(frac, 0, 1)));
    cap.knowledge = to;
    return to - have;
  }

  /**
   * THE HIGHEST TABLET HE CAN READ (update98; used from update B).
   * INT 1-2 → I, 3-5 → II, 6-8 → III, 9+ → IV; nothing at 0.
   */
  function tabletCap(cap) {
    const i = attr(cap, 'intelligence');
    if (i >= 9) return 4;
    if (i >= 6) return 3;
    if (i >= 3) return 2;
    if (i >= 1) return 1;
    return 0;
  }

  /** What his LEADERSHIP pays, per effect, as fractions. */
  function leadershipBonus(cap) {
    const n = attr(cap, 'leadership');
    const out = { speed: n * LEADERSHIP_PER_POINT, repair: n * LEADERSHIP_PER_POINT,
                  firefight: 0, breach: 0 };
    LEADERSHIP_STEPS.forEach(st => { if (n >= st.at) out[st.effect] += st.value; });
    return out;
  }

  /** What his ENDURANCE pays: suit air as a fraction, max HP flat. */
  function enduranceBonus(cap) {
    const n = attr(cap, 'endurance');
    return { air: n * ENDURANCE_AIR_PER_POINT, hpFlat: n * ENDURANCE_HP_PER_POINT };
  }

  /**
   * Can this barracks record be promoted at all?
   * Yes — anyone can, at any rank. What his rank decides is the PRICE
   * and the level he starts at. What is still refused is a record that
   * is not a living crewman: a beast has no rank to give up, and the
   * dead take no chairs.
   */
  function eligible(rec) {
    if (!rec) return false;
    /* A serialised cat carries `catKind` (a live one `isPet` too). She
       has no rank to give up, and a promoted animal would be a
       commander record with an animal's history in it. The spider and
       rat clauses that stood here went with update84: neither is a
       crewman any more, so neither can be a barracks record. */
    if (rec.isPet || rec.catKind || rec.kind === 'pet') return false;
    return !rec.dead;
  }

  /** The mastered skills a promotion would take out of the barracks —
   *  the screen has to say this out loud before the player commits. */
  function masteredOf(rec) {
    const max = (typeof MAX_SKILL_LEVEL !== 'undefined') ? MAX_SKILL_LEVEL : 3;
    return Object.entries(rec?.skills || {})
      .filter(([, s]) => (s?.level ?? 0) >= max)
      .map(([k]) => k);
  }

  // ── Levels ────────────────────────────────────────────────

  function xpToNext(cap) {
    if (!cap || cap.level >= COMMANDER_MAX_LEVEL) return 0;
    return COMMANDER_LEVEL_XP[cap.level - 1] ?? 0;
  }

  /**
   * Feed the commander XP. Returns how many levels he gained.
   *
   * The amount is whatever the crewman was ACTUALLY granted — already
   * multiplied by his corporation, already zero if he is capped out.
   * There is no hidden XP for a crew of masters: a veteran roster stops
   * teaching the commander, and that is the reason to keep hiring.
   */
  function addXP(cap, amount) {
    if (!cap || !(amount > 0) || cap.level >= COMMANDER_MAX_LEVEL) return 0;
    cap.xp += amount;
    let gained = 0;
    while (cap.level < COMMANDER_MAX_LEVEL && cap.xp >= xpToNext(cap)) {
      cap.xp -= xpToNext(cap);
      cap.level++;
      gained++;
    }
    if (cap.level >= COMMANDER_MAX_LEVEL) cap.xp = 0;
    return gained;
  }

  /** Total XP still owed before the next promotion (for the bar). */
  function xpProgress(cap) {
    const need = xpToNext(cap);
    if (!need) return 1;
    return Utils.clamp((cap.xp || 0) / need, 0, 1);
  }

  // ── The flying commander ────────────────────────────────────

  /* ── THE WORLD READS KARMA (update61) ─────────────────────
   *
   * Until now karma had exactly ONE reader — the position of the wall
   * on the chip board — so every decent thing and every ugly thing a
   * commander did came out as "you have one more slot on the left".
   * That is not a reputation, it is a statistic.
   *
   * These are the accessors the world asks. They live here, beside the
   * karma they read, so that "how bad is a 12" is answered in one place
   * rather than by each screen inventing its own thresholds.
   *
   * ONE-SIDED, deliberately (jj's call): a low karma costs, a high one
   * is not rewarded with a discount. If being decent paid at the till,
   * being ruthless would be free — you would keep the chips, the
   * tribute and the ugly side of the board and lose nothing for it.
   * What high karma buys is elsewhere: crew who will sign on, and
   * enemies who surrender rather than fight to the last man.
   *
   * The BANDS are the whole rule, and they are published so the tests
   * and the UI read the same numbers as the shops.
   */
  const KARMA_BANDS = [
    { upTo: 20,  surcharge: 0.25, label: 'NOTORIOUS' },
    { upTo: 35,  surcharge: 0.10, label: 'DISTRUSTED' },
    { upTo: 100, surcharge: 0,    label: null },
  ];
  /** At or below this, some ports will not deal with him at all. */
  const KARMA_SHUNNED = 10;

  /** The karma of whoever is flying, or 50 (neutral) with nobody. */
  function karmaNow() {
    const k = _active?.karma;
    return (typeof k === 'number') ? Utils.clamp(k, 0, 100) : 50;
  }

  /** The band a karma value falls in.
   *
   *  NO `||` FALLBACK HERE, DELIBERATELY (update61). The last band runs
   *  to 100 and `karmaNow()` clamps to 0-100, so every value lands in a
   *  band and a fallback would be dead code — the kind that reads as a
   *  safety net and is really just a place for a broken clamp to hide.
   *  Delete the second guard, keep the first: if the clamp ever goes,
   *  this throws instead of quietly pricing a corrupt record at par. */
  function band(karma = karmaNow()) {
    return KARMA_BANDS.find(b => karma <= b.upTo);
  }

  /**
   * What a port adds to its prices for the man in the chair.
   * 0 for anybody from the middle of the scale up — there is no
   * discount at the top, only a penalty at the bottom.
   */
  function priceSurcharge(karma = karmaNow()) { return band(karma).surcharge; }

  /** Multiply a price by this. Always >= 1. */
  function priceFactor(karma = karmaNow()) { return 1 + priceSurcharge(karma); }

  /** A short word for the HUD/shop, or null when nothing is wrong. */
  function reputationLabel(karma = karmaNow()) { return band(karma).label; }

  /**
   * WILL THIS PARTICULAR PORT DEAL WITH HIM?
   *
   * Only a SMALL part of them refuse (jj's call), and WHICH ones is
   * decided by the station's own seed — not by a fresh roll each time
   * the player walks in. A port that turns you away must still be
   * turning you away when you come back, or the player learns that
   * re-entering is a slot machine.
   *
   * And never all of them: a commander at karma 5 who could not buy
   * fuel anywhere would simply be stranded, which turns a reputation
   * penalty into the end of the run.
   */
  /* ── THE OTHER SIDE OF A BAD NAME (update70) ───────────────
   *
   * Until now karma was all penalty below the middle: dearer fuel,
   * dearer hands, closed docks. The player's design puts something on
   * the other side of it — the men the yard is hunting will DEAL with
   * a commander the honest ports already charge extra.
   *
   * That is deliberately the SAME line, not a new number: `band()`
   * already knows who the ports distrust (≤35) and `KARMA_SHUNNED`
   * already knows who they turn away (≤10). A separate threshold here
   * would be a second opinion about the same reputation, and the two
   * would drift the first time either was balanced.
   */
  function pirateWillDeal(karma = karmaNow()) { return priceSurcharge(karma) > 0; }

  /** How far under the port price he sells. Deeper for a man no
   *  honest dock will serve — by then the black market is the market. */
  function pirateDiscount(karma = karmaNow()) {
    if (!pirateWillDeal(karma)) return 0;
    return karma <= KARMA_SHUNNED ? 0.45 : 0.30;
  }

  function portRefuses(seed = 0, karma = karmaNow()) {
    if (karma > KARMA_SHUNNED) return false;
    // Deterministic in the seed: a third of ports, always the same third.
    return (Math.abs(Math.round(seed)) % 3) === 0;
  }

  /**
   * How the barracks treats him. Recruits are the reward side of the
   * scale that the shops deliberately do not give: a decent commander
   * has people queuing up, a notorious one pays over the odds for
   * whoever is desperate enough.
   */
  function recruitFactor(karma = karmaNow()) {
    if (karma <= KARMA_SHUNNED) return 1.6;
    if (karma <= 35)            return 1.25;
    if (karma >= 80)            return 0.85;
    return 1;
  }

  /**
   * HOW MANY HANDS ARE EVEN INTERESTED (update61).
   *
   * The price side of the barracks is `recruitFactor`; this is the
   * other half of the same sentence — a notorious commander does not
   * merely pay more, he finds fewer people at the hiring hall at all.
   * A DELTA on the roll, not a second roll, so a port with nobody in
   * it stays a port with nobody in it.
   */
  function recruitInterest(karma = karmaNow()) {
    if (karma <= KARMA_SHUNNED) return -2;
    if (karma <= 35)            return -1;
    if (karma >= 80)            return  1;
    return 0;
  }

  /**
   * WHAT THE WORLD DOES ABOUT IT, IN WORDS (update61).
   *
   * One source for the wording, read by the dossier and by the shop
   * banner. The refusal line is the important one: a port that will
   * not serve you and does not say why reads as a bug.
   */
  function karmaWorldLines(karma = karmaNow()) {
    const out = [];
    const sur = priceSurcharge(karma);
    out.push(sur > 0
      ? `Ports charge you +${Math.round(sur * 100)}% — ${reputationLabel(karma)}`
      : 'Ports charge you the going rate');
    if (karma <= KARMA_SHUNNED) out.push('Some ports will not trade with you at all');
    const sc = surrenderChance(karma);
    out.push(sc === 0 ? 'Beaten crews fight you to the last man — they never surrender'
                      : `A beaten crew strikes to you about ${Math.round(sc * 100)}% of the time`);
    const rf = recruitFactor(karma);
    out.push(rf > 1 ? `Recruits want +${Math.round((rf - 1) * 100)}% to sign on`
           : rf < 1 ? `Recruits sign on for ${Math.round((1 - rf) * 100)}% less`
                    : 'Recruits ask the usual fee');
    return out;
  }

  /**
   * WILL THEY STRIKE THEIR COLOURS TO *HIM* (update62)?
   *
   * The odds an enemy who is beaten offers surrender instead of
   * fighting on. 0.5 in the middle is exactly what the flat roll in
   * `combat.js` used to be, so an ordinary commander sees no change —
   * karma bends it from there.
   *
   * ZERO at the bottom, and that is the point: a crew that knows what
   * you do to people who give up does not give up. A notorious
   * commander fights every fight to the last man, which is longer,
   * costlier, and exactly the penalty §3.2 pkt 3 of the karma design
   * asks for. It is also the ONLY reward the top of the scale gets in
   * combat, so it has to be worth having.
   */
  function surrenderChance(karma = karmaNow()) {
    if (karma <= KARMA_SHUNNED) return 0;
    if (karma <= 35)            return 0.25;
    if (karma >= 80)            return 0.75;
    return 0.5;
  }

  function setActive(cap) { _active = cap ? migrate(cap) : null; }
  function active() { return _active; }

  /* ── THE OTHER SIDE HAS ONE TOO (update50) ────────────────
   *
   * Kept in a SECOND slot rather than a list, because exactly one
   * enemy commander can be in a fight at a time and a list would invite
   * the question of which of them a bonus came from. `bonusFor` picks
   * the slot by whose crew it was handed — that is the only place the
   * two are ever told apart.
   *
   * He is cleared at the end of every fight. A stale enemy commander
   * paying bonuses to the NEXT enemy would be invisible and would
   * make difficulty drift upward with nothing on screen to explain
   * it.
   */
  let _enemy = null;
  function setEnemy(cap) { _enemy = cap || null; }
  function enemy() { return _enemy; }

  /**
   * Called from CrewMember.addXP with the amount that was really
   * granted. One call site, one direction: crew → commander.
   */
  function mirror(amount) {
    if (!_active || !(amount > 0)) return 0;
    return addXP(_active, amount);
  }

  // ── Corporation bonuses ───────────────────────────────────

  /**
   * What the ACTIVE commander is worth to this crew member.
   * Returns zeroes for beasts and whenever no commander is flying — so
   * every caller can just multiply.
   */
  function bonusFor(crew) {
    const empty = { hp: 0, speed: 0, repair: 0, melee: 0,
                    firefight: 0, breach: 0, meleeResist: 0, air: 0, hpFlat: 0 };
    if (!crew || crew.isPet) return empty;
    // Whose commander is this? The side the man is on, and nothing else.
    const boss = crew.isPlayer ? _active : _enemy;
    if (!boss) return empty;

    /* NO BOARD BONUS ANY MORE (update99). The chips paid every hand
       aboard a standing percentage; the tablets that replaced them are
       USED, for a moment, and what a running one is worth is asked of
       Chips.runningValue where it applies (evasion, the shields) —
       never of the crew sheet. What is left here is the order that is
       running and his own corporation's share. */
    const out = { hp: 0, speed: 0, repair: 0, melee: 0, firefight: 0,
                  breach: 0, meleeResist: 0, air: 0, hpFlat: 0 };

    /* A RUNNING ORDER REACHES EVERY HAND ABOARD, whatever badge he
       wears — it is an order to the ship, not a corporation perk. So
       it is added BEFORE the corporation test below, through the same
       accessor every call site already uses. */
    if (crew.isPlayer && boss === _active) out.melee += orderBonus('melee');

    /* LEADERSHIP AND ENDURANCE REACH ONLY HIS OWN CORPORATION
       (update98, jj: "tylko na załogantów jego korporacji") — the same
       test the old picks had, in the same place. */
    if (crew.race !== boss.race) return out;
    const lead = leadershipBonus(boss);
    Object.keys(lead).forEach(k => { out[k] += lead[k]; });
    const end = enduranceBonus(boss);
    out.air += end.air;
    out.hpFlat += end.hpFlat;
    return out;
  }

  /**
   * Roll an opposing commander for a fight. Level and board scale with
   * the sector; the player is told his corporation and level and
   * NOTHING else.
   */
  function rollEnemy(sector = 1, opts = {}) {
    if (typeof CORP_KEYS === 'undefined') return null;
    const race = opts.race || Utils.pick(CORP_KEYS);
    const cap = {
      id: Utils.uid(), name: opts.name || 'Enemy Commander', race,
      level: Utils.clamp(opts.level ?? Utils.randIn(2, 2 + sector * 4),
                         1, COMMANDER_MAX_LEVEL),
      xp: 0, karma: opts.karma ?? Utils.randIn(0, 100),
      chips: [], attrs: {}, away: true,
    };
    migrate(cap);
    /* HE SPENDS HIS LEVELS TOO (update52). Nobody is sitting at the
       other ship's promotion screen, so the roll makes his choices
       for him — through spendPoint, the same door the player uses, so
       an enemy can never end up with a bonus the rules do not allow.
       Without this an enemy commander would be a level with no
       consequences, which is precisely the bug the player-side
       "nothing accrues unspent" rule creates on the far side. */
    {
      /* update98: attributes, through spendPoint — the same door the
         player uses. Knowledge and intelligence would buy him nothing
         (he gives no paid orders and reads no tablets), so his levels
         go to the two that reach his crew: a level with no
         consequences is the bug this roll exists to prevent. */
      const trades = ['leadership', 'endurance'];
      /* BOUNDED, deliberately. `while (owed > 0)` reads fine right up
         until something upstream makes a pick stop counting, and then
         the whole game hangs on a rolled enemy — which is not a bug
         anyone wants to meet in a fight. The count is known: one per
         level, so the loop is written with that bound. */
      for (let i = 0; i < COMMANDER_MAX_LEVEL && pointsOwed(cap) > 0; i++) {
        spendPoint(cap, Utils.pick(trades));
      }
    }
    /* NO BOARD FOR HIM (update99). The chips he used to carry are gone,
       and jj's tablets are the player's game — an enemy who fired them
       back would be a second system nobody asked for. His levels go to
       leadership and endurance above, which reach his crew. */
    return cap;
  }

  /* ── KARMA (update50) ─────────────────────────────────────
   *
   * The spec's table, and nothing outside it moves the needle:
   * repairs, firefighting, treating the wounded and shooting at an
   * armed enemy are simply the job. Karma is for decisions ABOUT
   * PEOPLE WHO CANNOT FIGHT BACK.
   *
   * One decision scores ONCE. Every event that carries a karma value
   * hands it to `shift()` at the moment it resolves, and no event
   * resolves twice — that is enforced upstream, where the choice is
   * consumed, not by remembering here what has already been counted.
   */
  const KARMA = {
    HELP_AT_COST:   5,    // helping when it costs you something
    RESCUE_AT_COST: 10,   // saving people at the expense of the run
    ROBBERY:       -5,    // taking from someone who cannot stop you
    KILL_HELPLESS: -10,   // finishing what has already surrendered
    EVACUATE:      -10,   // leaving a living crew behind (JJ: −10, not −15)
  };

  /**
   * Move a commander's karma and say what it cost him on the board.
   * Returns { from, to, wallMoved, killed } — `killed` being the chips
   * that were working before and are not now, which is the sentence
   * the player has to be shown BEFORE he commits, not after.
   */
  function shift(cap, delta) {
    if (!cap || !delta) return null;
    const from = cap.karma ?? 50;
    /* `killed` = tablets that worked before and are dark now — by the
       wall OR by their family's karma threshold (update99). */
    const working = (c) => (typeof Chips !== 'undefined')
      ? Chips.tablets(c).filter(t => t.eff > 0).length : 0;
    const before = working(cap);
    cap.karma = Utils.clamp(from + delta, 0, 100);
    const after = working(cap);
    return {
      from, to: cap.karma,
      wallMoved: (typeof Chips !== 'undefined')
        && Chips.wallColumn(from) !== Chips.wallColumn(cap.karma),
      killed: Math.max(0, before - after),
    };
  }

  /**
   * What WOULD happen — for the warning on the choice, before it is
   * taken. Does not touch the record.
   */
  function preview(cap, delta) {
    if (!cap || !delta || typeof Chips === 'undefined') return null;
    const from = cap.karma ?? 50;
    const to = Utils.clamp(from + delta, 0, 100);
    if (to === from) return { delta: 0, killed: 0, wallMoved: false };
    const working = (c) => Chips.tablets(c).filter(t => t.eff > 0).length;
    const live = working(cap);
    const probe = { ...cap, karma: to };
    const after = working(probe);
    return {
      delta: to - from,
      killed: Math.max(0, live - after),
      wallMoved: Chips.wallColumn(from) !== Chips.wallColumn(to),
    };
  }

  /** Seconds on the best mounted, working escape pod — 0 for none. */
  function podSeconds() {
    if (!_active || typeof Chips === 'undefined') return 0;
    return Chips.podSeconds(_active);
  }

  /**
   * WHAT EACH ATTRIBUTE IS WORTH TO HIM, in words (update98) — read by
   * the dossier and the promotion screen, so neither invents its own
   * wording of the same numbers. `cap` may be a probe with one more
   * point (the promotion screen shows "now → then").
   */
  function attrLine(cap, k) {
    const n = attr(cap, k);
    const pc = (v) => `${Math.round(v * 100)}%`;
    switch (k) {
      case 'knowledge':
        return `pool ${knowledgeMax(cap)}`;
      case 'intelligence': {
        const t = tabletCap(cap);
        return t ? `tablets up to Lv${t}` : 'reads no tablets';
      }
      case 'leadership': {
        const b = leadershipBonus(cap);
        const bits = [`+${pc(b.speed)} move`, `+${pc(b.repair)} repair`];
        if (b.firefight) bits.push(`+${pc(b.firefight)} fire`);
        if (b.breach)    bits.push(`+${pc(b.breach)} patch`);
        return n ? bits.join(' ') : 'no bonus';
      }
      case 'endurance': {
        const b = enduranceBonus(cap);
        return n ? `+${pc(b.air)} air  +${b.hpFlat} HP` : 'no bonus';
      }
    }
    return '';
  }

  /* ── The orders ─────────────────────────────────────────── */

  /** The orders THIS commander can give — one per mastered skill. */
  function ordersFor(cap) {
    const spec = Array.isArray(cap?.specialties) ? cap.specialties : [];
    return spec.map(k => COMMANDER_ORDERS[k]).filter(Boolean);
  }

  /** Has this order already been spent in the fight we are in? */
  function orderUsed(key) { return !!_orderUsed[key]; }

  /** What an order costs in knowledge — routine or special, one reader. */
  function orderCost(key) {
    return (ROUTINE_ORDERS[key] || COMMANDER_ORDERS[key])?.cost ?? 0;
  }

  /**
   * WHY AN ORDER CANNOT BE GIVEN, or null when it can.
   *
   * THE ONE implementation of the rule, for BOTH kinds of order since
   * update98. game.js needs the reason (it has to tell the player
   * something useful) and `giveOrder` needs the verdict; both go
   * through here, so the check that refuses the player and the check
   * that guards the record are one check.
   */
  /* `cap` defaults to the man in the chair; game.js passes its own
     record for the routine orders, the one `_hasCommander` asks about. */
  function orderRefusal(key, cap = _active) {
    const def = ROUTINE_ORDERS[key] || COMMANDER_ORDERS[key];
    if (!def) return 'No such order.';
    if (!cap) return `No commander in the chair — no orders: ${def.label}`;
    const special = !!COMMANDER_ORDERS[key];
    if (special && !ordersFor(cap).some(o => o.key === key)) {
      return `${def.label} — this commander never learned it.`;
    }
    if (special && _orderUsed[key]) return `${def.label} — already given this fight.`;
    const cost = orderCost(key);
    if (knowledge(cap) < cost) {
      return `${def.label} — not enough knowledge (${cost} needed, ${Math.floor(knowledge(cap))} left).`;
    }
    return null;
  }

  /**
   * Give an order: pay its knowledge, and for a special one mark it
   * spent and start its clock. Returns false when it cannot be given.
   *
   * It does NOT touch the ship: what the order DOES is game.js's
   * business, because that is where the ship is — and game.js calls
   * this only once the order has something to do, so a refused order
   * costs nothing.
   */
  function giveOrder(key, cap = _active) {
    if (orderRefusal(key, cap)) return false;
    if (!spendKnowledge(cap, orderCost(key))) return false;
    const def = COMMANDER_ORDERS[key];
    if (def) {
      _orderUsed[key] = true;
      if (def.hold > 0) _orderT[key] = def.hold;
    }
    return true;
  }

  /** Run the clocks down. Called once per combat frame. */
  function tickOrders(dt) {
    Object.keys(_orderT).forEach(k => {
      _orderT[k] -= dt;
      if (_orderT[k] <= 0) delete _orderT[k];
    });
  }

  /** What one running order pays into one effect. */
  function _pays(def, effect) {
    if (def.effect === effect) return def.value ?? 0;
    /* FLANK SPEED buys evasion as well as its own effect. A second
       field rather than a second order, so both halves share one
       clock and cannot end at different moments. */
    if (effect === 'evasion' && def.alsoEvasion) return def.alsoEvasion;
    return 0;
  }

  /**
   * What running orders are worth in one effect, right now.
   *
   * THE ONE RECONCILER. Two orders that both pay into an effect do NOT
   * add — the better of them stands, because a commander who happens
   * to have mastered both trades must not get a number nobody
   * balanced. Zero when nothing is running, so every reader can add it
   * blind.
   */
  function orderBonus(effect) {
    if (!_active) return 0;
    let v = 0;
    Object.keys(_orderT).forEach(k => {
      v = Math.max(v, _pays(COMMANDER_ORDERS[k], effect));
    });
    return v;
  }

  /** Seconds left on whatever is paying into an effect, 0 when none. */
  function orderLeft(effect) {
    let t = 0;
    Object.keys(_orderT).forEach(k => {
      if (_pays(COMMANDER_ORDERS[k], effect) > 0) t = Math.max(t, _orderT[k]);
    });
    return t;
  }

  /** A new fight: every order is available again, and none is running. */
  function resetOrders() { _orderT = {}; _orderUsed = {}; }

  /**
   * Re-seat the max-HP bonus on a crew list WITHOUT healing anybody.
   *
   * maxHp is a stored number that half the game divides by, so it
   * cannot be a live getter without every ratio in the HUD shifting
   * under the player mid-frame. Instead it is recomputed at the few
   * moments the bonus can actually change — launch and promotion — and
   * the current hp is scaled to keep the SAME PERCENTAGE. A man at half
   * health stays at half health; a downed man does not stand up.
   */
  function reseatMaxHp(crewList) {
    (crewList || []).forEach(c => {
      if (!c || c.isPet) return;
      const base = c.baseMaxHp ?? c.maxHp;
      c.baseMaxHp = base;
      const b = bonusFor(c);
      // A share (chips) and a flat figure (ENDURANCE, update98).
      const want = Math.max(1, Math.round(base * (1 + b.hp)) + (b.hpFlat || 0));
      if (want === c.maxHp) return;
      const frac = Utils.clamp((c.hp ?? 0) / (c.maxHp || 1), 0, 1);
      c.maxHp = want;
      c.hp = Math.max(c.dead || c.down ? 0 : 1, Math.round(want * frac));
    });
  }

  return {
    fromCrew, eligible, masteredOf, priceFor, price: commanderPrice,
    migrate, attr, pointsSpent, pointsOwed, spendPoint, attrLine,
    knowledge, knowledgeMax, spendKnowledge, refillKnowledge, tabletCap,
    leadershipBonus, enduranceBonus,
    xpToNext, xpProgress, addXP,
    setActive, active, setEnemy, enemy, rollEnemy, mirror,
    // The world reads karma (update61)
    KARMA_BANDS, KARMA_SHUNNED, karmaNow, band, priceSurcharge, priceFactor,
    reputationLabel, portRefuses, recruitFactor, recruitInterest, surrenderChance,
    pirateWillDeal, pirateDiscount, KARMA_SHUNNED,
    karmaWorldLines,
    bonusFor, podSeconds, reseatMaxHp,
    shift, preview, KARMA,
    ORDERS: COMMANDER_ORDERS,
    ROUTINE: ROUTINE_ORDERS,
    ordersFor, giveOrder, orderRefusal, orderUsed, orderLeft, orderBonus, orderCost,
    tickOrders, resetOrders,
    MAX_LEVEL: COMMANDER_MAX_LEVEL,
    LEVEL_XP: COMMANDER_LEVEL_XP,
    ATTRS: COMMANDER_ATTRS,
    ATTR_LABEL: COMMANDER_ATTR_LABEL,
    KNOWLEDGE_BASE, KNOWLEDGE_PER_POINT, KNOWLEDGE_AFTER_FIGHT,
    LEADERSHIP_STEPS, ENDURANCE_AIR_PER_POINT, ENDURANCE_HP_PER_POINT,
  };

})();

/* Classic scripts keep top-level `const` in the script's own lexical
   scope, NOT on window — so a loader cannot tell whether this file ran.
   Publish explicitly, the way base.js does, so game.js can spot a stale
   index.html and load this module itself. */
if (typeof window !== 'undefined') {
  window.Commander = Commander;
  window.COMMANDER_MAX_LEVEL = COMMANDER_MAX_LEVEL;
  window.COMMANDER_ORDERS = COMMANDER_ORDERS;
}
