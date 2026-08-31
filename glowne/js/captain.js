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
      away:    false,                    // out on a contract right now
    };
  }

  /** Can this barracks record be promoted at all? */
  function eligible(rec) {
    if (!rec || !rec.skills) return false;
    const max = (typeof MAX_SKILL_LEVEL !== 'undefined') ? MAX_SKILL_LEVEL : 3;
    return Object.values(rec.skills).some(s => (s?.level ?? 0) >= max);
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
    if (!_active || !crew || crew.isPlayer === false || crew.isBeast) return empty;

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
    const chip = (e) => (typeof Chips !== 'undefined' ? Chips.bonus(_active, e) : 0);
    const out = {
      hp:          chip('hp'),
      speed:       chip('speed'),
      repair:      chip('repair'),
      melee:       chip('melee'),
      firefight:   chip('firefight'),
      breach:      chip('breach'),
      meleeResist: chip('meleeResist'),
    };

    if (crew.race !== _active.race) return out;
    const per = CAPTAIN_CORP_BONUS[_active.race];
    if (!per) return out;
    const lvl = Utils.clamp(_active.level, 0, CAPTAIN_MAX_LEVEL);
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
    fromCrew, eligible, masteredOf,
    xpToNext, xpProgress, addXP,
    setActive, active, mirror,
    bonusFor, shipBonus, podSeconds, bonusLines, reseatMaxHp,
    MAX_LEVEL: CAPTAIN_MAX_LEVEL,
    LEVEL_XP: CAPTAIN_LEVEL_XP,
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
