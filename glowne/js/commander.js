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
     · grows to level 8 and pays a per-level bonus to crew of HIS OWN
       corporation, and to nobody else;
     · carries a karma reading (0 = ruthless, 100 = principled) that
       update44 will turn into the CPU board.

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

/* ── THE CORPORATION OFFERS A CHOICE, NOT A GIFT (update52) ──
 *
 * Every corporation used to pay its own people two bonuses per
 * commander level automatically. With 24 levels instead of 8 that
 * would have become +24%/+48% for doing nothing, so the automatic
 * payout is DELETED and replaced by a decision: each level the player
 * picks ONE of his corporation's two trades and it grows by 0.5%.
 *
 * Which two he may pick between is still the corporation's business —
 * that is what makes flying a Terra commander different from a
 * Phoenix one — but nothing accrues unspent.
 */
const COMMANDER_CORP_CHOICE = {
  aquarius: ['hp',     'speed' ],
  pegasus:  ['speed',  'breach'],
  terra:    ['hp',     'repair'],
  phoenix:  ['melee',  'firefight'],
};

/** What one pick is worth. */
const COMMANDER_PICK_STEP = 0.005;      // +0.5%

/** Labels for the pick screen — the player must know what he is buying. */
const COMMANDER_PICK_LABEL = {
  hp:        'CREW MAX HP',
  speed:     'CREW SPEED',
  repair:    'REPAIR SPEED',
  melee:     'MELEE DAMAGE',
  firefight: 'FIREFIGHT SPEED',
  breach:    'BREACH PATCHING',
};

const Commander = (() => {

  /* The commander currently flying. ONE reference to the run's own
     record — not a copy — so nothing can drift out of step with it. */
  let _active = null;

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
    return {
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

      /* WHAT HE HAS SPENT HIS LEVELS ON. One counter per effect; the
         bonus is these counters times COMMANDER_PICK_STEP and nothing
         else, so there is no second place a percentage can live.
         Levels not yet spent are `level - picksMade`, computed. */
      picks:   {},

      away:    false,                    // out on a contract right now
    };
  }

  /** What promoting THIS crew record costs today, in CC. */
  function priceFor(rec) { return commanderPrice(rankLevelOf(rec)); }

  /* ── THE LEVEL-UP CHOICE (update52) ──────────────────────── */

  /** The two effects this commander's corporation lets him grow. */
  function choicesFor(cap) {
    return COMMANDER_CORP_CHOICE[cap?.race] || COMMANDER_CORP_CHOICE.terra;
  }

  /** How many picks he has already made. */
  function picksMade(cap) {
    return Object.values(cap?.picks || {}).reduce((a, b) => a + (b || 0), 0);
  }

  /** How many are owed to the player right now — promotion included. */
  function picksOwed(cap) {
    if (!cap) return 0;
    return Math.max(0, Utils.clamp(cap.level, 0, COMMANDER_MAX_LEVEL) - picksMade(cap));
  }

  /**
   * Spend ONE owed pick. Returns true if it was spent.
   * Refuses an effect his corporation does not offer and refuses to
   * spend a level he has not reached — those are the two ways this
   * could quietly become free percentage.
   */
  function spendPick(cap, effect) {
    if (!cap || picksOwed(cap) <= 0) return false;
    if (!choicesFor(cap).includes(effect)) return false;
    cap.picks = cap.picks || {};
    cap.picks[effect] = (cap.picks[effect] || 0) + 1;
    return true;
  }

  /** What his picks are worth in one effect, as a fraction. */
  function pickBonus(cap, effect) {
    return (cap?.picks?.[effect] || 0) * COMMANDER_PICK_STEP;
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
    /* A serialised cat carries `catKind`; spiders and rats carry
       `isBeast`. Neither has a rank to give up, and a promoted animal
       would be a commander record with an animal's history in it. */
    if (rec.isBeast || rec.catKind || rec.kind === 'pet'
        || rec.kind === 'spider' || rec.kind === 'vermin') return false;
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

  function setActive(cap) { _active = cap || null; }
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
                    firefight: 0, breach: 0, meleeResist: 0 };
    if (!crew || crew.isBeast) return empty;
    // Whose commander is this? The side the man is on, and nothing else.
    const boss = crew.isPlayer ? _active : _enemy;
    if (!boss) return empty;

    /* ── TWO SOURCES, ONE ACCESSOR (update49) ────────────────
     *
     * The corporation bonus reaches only the commander's OWN people;
     * the CPU board reaches every hand aboard, whatever badge they
     * wear. Both are summed here, so every call site that already
     * asked `_capBonus()` — max HP, walking speed, repair rate, melee
     * — picks the chips up without knowing they exist. One accessor,
     * and therefore no second path by which a bonus could arrive
     * twice.
     *
     * They ADD, they do not compound: the spec is explicit that the
     * chip ceiling does not bound the corporation's share and that
     * the two are never multiplied together.
     */
    const chip = (e) => (typeof Chips !== 'undefined' ? Chips.bonus(boss, e) : 0);
    const out = {
      hp:          chip('hp'),
      speed:       chip('speed'),
      repair:      chip('repair'),
      melee:       chip('melee'),
      firefight:   chip('firefight'),
      breach:      chip('breach'),
      meleeResist: chip('meleeResist'),
    };

    /* THE CORPORATION SHARE IS WHAT HE CHOSE, and it still reaches
       only his own people. update52 deleted the automatic per-level
       payout: with 24 levels it would have handed out +48% for making
       no decision at all. What is here instead is exactly the picks
       the player spent, at 0.5% each — one register, no accrual. */
    if (crew.race !== boss.race) return out;
    Object.keys(out).forEach(k => { out[k] += pickBonus(boss, k); });
    return out;
  }

  /**
   * A board bonus that belongs to the SHIP or the run rather than to
   * one crew member — gun charge time, the bleedout clock, field aid,
   * tribute. Same board, same single source; only the audience differs.
   */
  function shipBonus(effect) {
    if (!_active || typeof Chips === 'undefined') return 0;
    return Chips.bonus(_active, effect);
  }

  /**
   * Roll an opposing commander for a fight. Level and board scale with
   * the sector; the player is told his corporation and level and
   * NOTHING else — no board, no chip list (spec §9).
   */
  function rollEnemy(sector = 1, opts = {}) {
    if (typeof CORP_KEYS === 'undefined') return null;
    const race = opts.race || Utils.pick(CORP_KEYS);
    const cap = {
      id: Utils.uid(), name: opts.name || 'Enemy Commander', race,
      level: Utils.clamp(opts.level ?? Utils.randIn(2, 2 + sector * 4),
                         1, COMMANDER_MAX_LEVEL),
      xp: 0, karma: opts.karma ?? Utils.randIn(0, 100),
      chips: [], picks: {}, away: true,
    };
    /* HE SPENDS HIS LEVELS TOO (update52). Nobody is sitting at the
       other ship's promotion screen, so the roll makes his choices
       for him — through spendPick, the same door the player uses, so
       an enemy can never end up with a bonus the rules do not allow.
       Without this an enemy commander would be a level with no
       consequences, which is precisely the bug the player-side
       "nothing accrues unspent" rule creates on the far side. */
    {
      const trades = COMMANDER_CORP_CHOICE[race] || COMMANDER_CORP_CHOICE.terra;
      /* BOUNDED, deliberately. `while (owed > 0)` reads fine right up
         until something upstream makes a pick stop counting, and then
         the whole game hangs on a rolled enemy — which is not a bug
         anyone wants to meet in a fight. The count is known: one per
         level, so the loop is written with that bound. */
      for (let i = 0; i < COMMANDER_MAX_LEVEL && picksOwed(cap) > 0; i++) {
        spendPick(cap, Utils.pick(trades));
      }
    }
    /* A board built out of the SAME items and the same rules — an
       enemy whose bonuses came from somewhere else would be a second
       implementation of the whole system. */
    if (typeof Chips !== 'undefined' && typeof CargoItem !== 'undefined') {
      const board = Chips.board(cap);
      const want = Math.min(3, Math.floor(sector / 2) + (opts.chips ?? 1));
      for (let i = 0; i < want; i++) {
        const key = Chips.rollDrop(sector, { maxLevel: Math.min(3, sector) });
        board.autoPlace(new CargoItem(key));
      }
      /* A LOW COMMANDER STILL CARRIES SOMETHING (update52a).
         With one cell per level, a level 2 or 3 enemy has two or three
         squares and the karma wall may take one of them — so a rolled
         level II bar has nowhere to go and the board came out EMPTY,
         which made him a commander with no consequences at all. Fall
         back to level I chips, which are one cell each and fit
         anywhere his conscience allows. */
      if (!board.items.length) {
        for (const key of Object.keys(CHIP_DEFS)) {
          if (board.autoPlace(new CargoItem(Chips.itemKey(key, 1)))) break;
        }
      }
      Chips.commit(cap, board);
    }
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
    const before = (typeof Chips !== 'undefined') ? Chips.live(cap).length : 0;
    cap.karma = Utils.clamp(from + delta, 0, 100);
    const after = (typeof Chips !== 'undefined') ? Chips.live(cap).length : 0;
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
    const live = Chips.live(cap).length;
    const probe = { ...cap, karma: to };
    const after = Chips.live(probe).length;
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

  /** Human-readable lines for the base screen. */
  function bonusLines(cap) {
    if (!cap) return [];
    /* Read straight off the picks, so the card cannot claim a bonus
       the crew are not actually getting. Only the two his corporation
       offers are ever listed, in that order, so an unspent trade shows
       as +0% rather than vanishing. */
    return choicesFor(cap).map(k => {
      const v = pickBonus(cap, k) * 100;
      return [`+${v.toFixed(v % 1 ? 1 : 0)}%`, COMMANDER_PICK_LABEL[k] || k];
    });
  }

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
      if (!c || c.isBeast) return;
      const base = c.baseMaxHp ?? c.maxHp;
      c.baseMaxHp = base;
      const want = Math.max(1, Math.round(base * (1 + bonusFor(c).hp)));
      if (want === c.maxHp) return;
      const frac = Utils.clamp((c.hp ?? 0) / (c.maxHp || 1), 0, 1);
      c.maxHp = want;
      c.hp = Math.max(c.dead || c.down ? 0 : 1, Math.round(want * frac));
    });
  }

  return {
    fromCrew, eligible, masteredOf, priceFor, price: commanderPrice,
    choicesFor, picksMade, picksOwed, spendPick, pickBonus,
    xpToNext, xpProgress, addXP,
    setActive, active, setEnemy, enemy, rollEnemy, mirror,
    bonusFor, shipBonus, podSeconds, bonusLines, reseatMaxHp,
    shift, preview, KARMA,
    MAX_LEVEL: COMMANDER_MAX_LEVEL,
    LEVEL_XP: COMMANDER_LEVEL_XP,
    PICK_STEP: COMMANDER_PICK_STEP,
    PICK_LABEL: COMMANDER_PICK_LABEL,
    CORP_CHOICE: COMMANDER_CORP_CHOICE,
  };

})();

/* Classic scripts keep top-level `const` in the script's own lexical
   scope, NOT on window — so a loader cannot tell whether this file ran.
   Publish explicitly, the way base.js does, so game.js can spot a stale
   index.html and load this module itself. */
if (typeof window !== 'undefined') {
  window.Commander = Commander;
  window.COMMANDER_MAX_LEVEL = COMMANDER_MAX_LEVEL;
}
