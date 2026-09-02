/* ============================================================
   MOON WARS — captain.js  (update43)

   THE CAPTAIN IS NOT A MAN ON THE DECK.

   He has no HP, no walk cycle, no console and no boarding orders. He
   cannot be shot, burned or vented. He belongs to the EXPEDITION, not
   to a compartment — which is exactly why he is a separate record and
   not another CrewMember: `ship.crew` is the list of bodies aboard, and
   every filter in the game reads it that way.

   What he does:
     · mirrors his crew's XP — every point a crewman is actually
       granted is copied to the captain, never taken from him;
     · grows to level 8 and pays a per-level bonus to crew of HIS OWN
       corporation, and to nobody else;
     · carries a karma reading (0 = ruthless, 100 = principled) that
       update44 will turn into the CPU board.

   He dies with the ship or with the last of his people, unless an
   escape pod gets him out first (update44). Losing him costs the
   levels, not the base.
   ============================================================ */

'use strict';

/** Level 8 is the ceiling: the CPU board's last row opens there and
 *  nothing above it would have anywhere to go. Do NOT re-add a higher
 *  cap without giving those levels something to unlock. */
const CAPTAIN_MAX_LEVEL = 8;

/* XP to go from level N to N+1. Rising, so the first promotions land
   inside a player's first contract and the last one is a campaign.
   Calibrated against a measured ~145 XP of crew XP per fight with a
   four-hand crew (see XP_RATES in crew.js): roughly two fights to
   level 2, and something near four full Apophis runs to reach 8. */
const CAPTAIN_LEVEL_XP = [300, 700, 1200, 1900, 2800, 4000, 5500];

/* ── PROMOTION TIERS (update51) ───────────────────────────────
 *
 * Before update51 only a crewman who had MASTERED a skill could take
 * the chair. That rule put the first captain eight to ten fights away
 * and — once every ORDER in the game went behind a captain — it left
 * a fresh save with no door control at all for those fights.
 *
 * So the rule is gone and a CEILING takes its place. Anyone can be
 * promoted; what the man was worth as a crewman is what his CPU board
 * can ever become. The ceiling is set at the moment of promotion and
 * is permanent: nothing he does as captain raises it, because the
 * whole point is that the man you spend decides the ship you get.
 *
 * The INDEX is the mastered-skill count, so this table is read
 * directly by it — do not reorder.
 */
const CAPTAIN_TIERS = [
  { stars: 0, maxRows: 2, maxChipLevel: 2, price: 100, label: 'szeregowy'         },
  { stars: 1, maxRows: 3, maxChipLevel: 3, price: 150, label: 'srebrna gwiazdka'  },
  { stars: 2, maxRows: 4, maxChipLevel: 4, price: 250, label: 'dwie gwiazdki'     },
  { stars: 3, maxRows: 5, maxChipLevel: 4, price: 400, label: 'złota gwiazdka'    },
];

/* Captains saved BEFORE update51 carry no ceiling. Every one of them
   was promoted under the old mastery rule and played with the whole
   board, so walling off rows he has already filled would destroy
   chips the player owns. Old records keep everything. */
const CAPTAIN_LEGACY_TIER = { maxRows: 5, maxChipLevel: 4 };

/** Per captain LEVEL, for crew of the captain's own corporation only. */
const CAPTAIN_CORP_BONUS = {
  aquarius: { hp: 0.01,  speed: 0.01                            },
  pegasus:  { hp: 0.005, speed: 0.015                           },
  terra:    { hp: 0.01,               repair: 0.02              },
  phoenix:  { hp: 0.005,                            melee: 0.01 },
};

const Captain = (() => {

  /* The captain currently flying. ONE reference to the run's own
     record — not a copy — so nothing can drift out of step with it. */
  let _active = null;

  // ── Records ───────────────────────────────────────────────

  /**
   * Promote a serialised crew record into a captain.
   * The man LEAVES the barracks: no copy is made, and there is no way
   * back. His service record travels with him because the memorial
   * still wants it; his skills come along as history and grant nothing.
   */
  function fromCrew(rec) {
    if (!rec) return null;
    const tier = tierFor(rec);
    return {
      id:      rec.id || Utils.uid(),
      name:    rec.name || 'Captain',
      race:    rec.race || 'terra',
      level:   1,
      xp:      0,
      karma:   50,                       // 0 = ruthless … 100 = principled
      battles: rec.battles ?? 0,
      wins:    rec.wins    ?? 0,
      escapes: rec.escapes ?? 0,
      kills:   rec.kills   ?? 0,
      pastSkills: Utils.deepClone(rec.skills || {}),   // history, not power
      chips:   [],                       // update44

      /* The ceiling, frozen at promotion (update51). Written here and
         nowhere else: no code path raises these afterwards. */
      stars:        tier.stars,
      maxRows:      tier.maxRows,
      maxChipLevel: tier.maxChipLevel,

      away:    false,                    // out on a contract right now
    };
  }

  /** The tier a crew record would be promoted INTO. */
  function tierFor(rec) {
    const n = Utils.clamp(masteredOf(rec).length, 0, CAPTAIN_TIERS.length - 1);
    return CAPTAIN_TIERS[n];
  }

  /** What a promotion costs today, in CC. */
  function priceFor(rec) { return tierFor(rec).price; }

  /**
   * The ceiling a CAPTAIN record actually flies under. Every reader —
   * the board, the shelf rule, the card — goes through this one
   * function, so a record saved before update51 is widened in exactly
   * one place instead of being guessed at four call sites.
   */
  function ceiling(cap) {
    if (!cap) return { maxRows: 0, maxChipLevel: 0 };
    return {
      maxRows:      cap.maxRows      ?? CAPTAIN_LEGACY_TIER.maxRows,
      maxChipLevel: cap.maxChipLevel ?? CAPTAIN_LEGACY_TIER.maxChipLevel,
    };
  }

  /**
   * Can this barracks record be promoted at all?
   * update51: yes — anyone can. Mastery no longer gates the chair, it
   * only decides how far the board goes (see CAPTAIN_TIERS). What is
   * still refused is a record that is not a living crewman: a beast
   * has no rank to give up, and the dead take no chairs.
   */
  function eligible(rec) {
    if (!rec) return false;
    /* A serialised cat carries `catKind`; spiders and rats carry
       `isBeast`. Neither has a rank to give up, and a promoted animal
       would be a captain record with an animal's history in it. */
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
    if (!cap || cap.level >= CAPTAIN_MAX_LEVEL) return 0;
    return CAPTAIN_LEVEL_XP[cap.level - 1] ?? 0;
  }

  /**
   * Feed the captain XP. Returns how many levels he gained.
   *
   * The amount is whatever the crewman was ACTUALLY granted — already
   * multiplied by his corporation, already zero if he is capped out.
   * There is no hidden XP for a crew of masters: a veteran roster stops
   * teaching the captain, and that is the reason to keep hiring.
   */
  function addXP(cap, amount) {
    if (!cap || !(amount > 0) || cap.level >= CAPTAIN_MAX_LEVEL) return 0;
    cap.xp += amount;
    let gained = 0;
    while (cap.level < CAPTAIN_MAX_LEVEL && cap.xp >= xpToNext(cap)) {
      cap.xp -= xpToNext(cap);
      cap.level++;
      gained++;
    }
    if (cap.level >= CAPTAIN_MAX_LEVEL) cap.xp = 0;
    return gained;
  }

  /** Total XP still owed before the next promotion (for the bar). */
  function xpProgress(cap) {
    const need = xpToNext(cap);
    if (!need) return 1;
    return Utils.clamp((cap.xp || 0) / need, 0, 1);
  }

  // ── The flying captain ────────────────────────────────────

  function setActive(cap) { _active = cap || null; }
  function active() { return _active; }

  /* ── THE OTHER SIDE HAS ONE TOO (update50) ────────────────
   *
   * Kept in a SECOND slot rather than a list, because exactly one
   * enemy captain can be in a fight at a time and a list would invite
   * the question of which of them a bonus came from. `bonusFor` picks
   * the slot by whose crew it was handed — that is the only place the
   * two are ever told apart.
   *
   * He is cleared at the end of every fight. A stale enemy captain
   * paying bonuses to the NEXT enemy would be invisible and would
   * make difficulty drift upward with nothing on screen to explain
   * it.
   */
  let _enemy = null;
  function setEnemy(cap) { _enemy = cap || null; }
  function enemy() { return _enemy; }

  /**
   * Called from CrewMember.addXP with the amount that was really
   * granted. One call site, one direction: crew → captain.
   */
  function mirror(amount) {
    if (!_active || !(amount > 0)) return 0;
    return addXP(_active, amount);
  }

  // ── Corporation bonuses ───────────────────────────────────

  /**
   * What the ACTIVE captain is worth to this crew member.
   * Returns zeroes for beasts and whenever no captain is flying — so
   * every caller can just multiply.
   */
  function bonusFor(crew) {
    const empty = { hp: 0, speed: 0, repair: 0, melee: 0,
                    firefight: 0, breach: 0, meleeResist: 0 };
    if (!crew || crew.isBeast) return empty;
    // Whose captain is this? The side the man is on, and nothing else.
    const boss = crew.isPlayer ? _active : _enemy;
    if (!boss) return empty;

    /* ── TWO SOURCES, ONE ACCESSOR (update49) ────────────────
     *
     * The corporation bonus reaches only the captain's OWN people;
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

    if (crew.race !== boss.race) return out;
    const per = CAPTAIN_CORP_BONUS[boss.race];
    if (!per) return out;
    const lvl = Utils.clamp(boss.level, 0, CAPTAIN_MAX_LEVEL);
    out.hp     += (per.hp     ?? 0) * lvl;
    out.speed  += (per.speed  ?? 0) * lvl;
    out.repair += (per.repair ?? 0) * lvl;
    out.melee  += (per.melee  ?? 0) * lvl;
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
   * Roll an opposing captain for a fight. Level and board scale with
   * the sector; the player is told his corporation and level and
   * NOTHING else — no board, no chip list (spec §9).
   */
  function rollEnemy(sector = 1, opts = {}) {
    if (typeof CORP_KEYS === 'undefined') return null;
    const race = opts.race || Utils.pick(CORP_KEYS);
    const cap = {
      id: Utils.uid(), name: opts.name || 'Enemy Captain', race,
      level: Utils.clamp(opts.level ?? Utils.randIn(1, 1 + sector * 2),
                         1, CAPTAIN_MAX_LEVEL),
      xp: 0, karma: opts.karma ?? Utils.randIn(0, 100),
      chips: [], away: true,
    };
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
   * Move a captain's karma and say what it cost him on the board.
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
    const per = CAPTAIN_CORP_BONUS[cap?.race];
    if (!per) return [];
    const lvl = Utils.clamp(cap.level, 0, CAPTAIN_MAX_LEVEL);
    const pct = v => `+${(v * lvl * 100).toFixed(v * lvl * 100 % 1 ? 1 : 0)}%`;
    const out = [];
    if (per.hp)     out.push([pct(per.hp),     'MAX HP']);
    if (per.speed)  out.push([pct(per.speed),  'MOVE SPEED']);
    if (per.repair) out.push([pct(per.repair), 'REPAIR SPEED']);
    if (per.melee)  out.push([pct(per.melee),  'MELEE DAMAGE']);
    return out;
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
    fromCrew, eligible, masteredOf, tierFor, priceFor, ceiling,
    xpToNext, xpProgress, addXP,
    setActive, active, setEnemy, enemy, rollEnemy, mirror,
    bonusFor, shipBonus, podSeconds, bonusLines, reseatMaxHp,
    shift, preview, KARMA,
    MAX_LEVEL: CAPTAIN_MAX_LEVEL,
    LEVEL_XP: CAPTAIN_LEVEL_XP,
    TIERS: CAPTAIN_TIERS,
    CORP_BONUS: CAPTAIN_CORP_BONUS,
  };

})();

/* Classic scripts keep top-level `const` in the script's own lexical
   scope, NOT on window — so a loader cannot tell whether this file ran.
   Publish explicitly, the way base.js does, so game.js can spot a stale
   index.html and load this module itself. */
if (typeof window !== 'undefined') {
  window.Captain = Captain;
  window.CAPTAIN_MAX_LEVEL = CAPTAIN_MAX_LEVEL;
}
