/* ============================================================
   MOON WARS — save.js
   Persistent save system using localStorage.
   Manages: run state, scrap bank, crew graveyard,
            unlocks, and high scores.
   ============================================================ */

'use strict';

const Save = (() => {

  const SAVE_KEY      = 'moonwars_save_v1';
  const SETTINGS_KEY  = 'moonwars_settings_v1';

  // ── Default state ─────────────────────────────────────────

  function _defaultSave() {
    return {
      version: 1,

      // Persistent resources
      scrapBank: 0,

      // Unlocked ships / crew types
      unlocks: {
        ships:    ['frigate'],
        crewRaces: ['human'],
      },

      // Graveyard: crew who died across all runs
      graveyard: [],

      // High score table
      highScores: [],

      // Total runs, victories
      stats: {
        runs:      0,
        victories: 0,
        deaths:    0,
        scrapEarned: 0,
        enemiesKilled: 0,
      },

      // Current run (null if not in run)
      run: null,
      /* WHICH MOONS ARE OPEN. One entry in the demo; the Moon Gate is
         what adds to it in the full version. A list rather than a flag
         so that "where can I fly" never becomes a second question with
         a second answer. */
      unlockedRegions: [DEFAULT_REGION],
      /* THE WANTED LIST (update64). Meta-progression, like the
         graveyard beside it — a pirate is remembered between contracts
         and only leaves this list when he is handed in.
         NULL, not [], and the difference matters: null means "this
         save has never had a board" and gets its starting name from
         `_seedWanted`, while an empty ARRAY means a player who has
         hunted everyone down and is waiting for the next contract to
         put somebody new up. Collapsing the two would refill the board
         out of nowhere every time such a player reloaded. */
      wanted: null,
    };
  }

  /* ══ THE WANTED LIST (update64) ═══════════════════════════
   *
   * ONE REGISTER, and this is it. The map does not keep its own copy
   * of a pirate and no fight invents a second "sector boss" with the
   * same name — an encounter POINTS at a record here by id. Two copies
   * of one man would drift the first time either was updated, which is
   * the oldest rule in this project and the risk the design document
   * names first.
   */
  const WANTED_MAX = 4;
  /* What a man who has already escaped one brig is worth next time. */
  const ESCAPE_BOUNTY_RAISE = 1.5;
  /* …and how much harder he is to take again. */
  const ESCAPE_LEVEL_GAIN = 2;

  /**
   * HE DID NOT SPEND THE TIME IDLE (update67).
   *
   * A man who slips a brig comes back with a better ship and better
   * people — the player's call, and the right one: a re-listed pirate
   * who was only DEARER would be free money for a crew that had
   * already beaten him once.
   *
   * `escapes` is the ONE register for this. The level rises off it,
   * the fight reads it for how much ship and crew to give him, and
   * the price rises off the price. Nothing else is stored, so nothing
   * else can drift.
   */
  function _harden(w) {
    w.escapes = (w.escapes ?? 0) + 1;
    w.level   = Utils.clamp((w.level ?? 5) + ESCAPE_LEVEL_GAIN, 1, 24);
  }
  const PIRATE_NAMES = [
    'Rask Vole', 'Odile Crane', 'Bern Halloway', 'Sable Nix', 'Corvin Dax',
    'Mira Quell', 'Tobin Skarr', 'Yara Voss', 'Elan Ruck', 'Petra Ashe',
  ];

  /** What a name on the list is worth, from his level and nothing else.
   *  ONE figure: the body is half of it, and the half is computed at
   *  the point of sale rather than stored beside this. */
  function wantedBounty(level) { return Math.round(80 + level * 20); }

  /** Give a board to a save that has never had one. An EMPTY board is
   *  left empty: it belongs to a player who has caught everybody. */
  function _seedWanted() {
    if (!_data) return;
    if (Array.isArray(_data.wanted)) return;
    _data.wanted = [makeWanted(1)];
  }

  /** Roll a fresh face for the list. Never a name already on it. */
  function makeWanted(sector = 1) {
    const taken = new Set((_data?.wanted ?? []).map(w => w.name));
    const pool  = PIRATE_NAMES.filter(n => !taken.has(n));
    const name  = pool.length ? Utils.pick(pool) : `Pirate ${Utils.uid()}`;
    const level = Utils.clamp(Utils.randInt(3, 6 + sector), 1, 24);
    return {
      id: `w${Utils.uid()}`,
      name,
      race: (typeof CORP_KEYS !== 'undefined') ? Utils.pick(CORP_KEYS) : 'terra',
      level,
      bounty: wantedBounty(level),
      state: 'wanted',
      region: _data?.run?.region ?? DEFAULT_REGION,
    };
  }

  /** Everyone still worth hunting. A man who has been handed in is
   *  REMOVED, not flagged — there is no `delivered` state to filter
   *  out, and so no way for a stale flag to hide somebody who is
   *  still out there. */
  function wanted() { return [...(_data?.wanted ?? [])]; }
  function wantedById(id) { return (_data?.wanted ?? []).find(w => w.id === id) || null; }

  /** Add one, up to the ceiling. Returns the man, or null if full —
   *  a list that grows without bound is the third risk in the design. */
  function addWanted(sector = 1) {
    if (!_data) return null;
    _data.wanted = _data.wanted ?? [];
    if (_data.wanted.length >= WANTED_MAX) return null;
    const w = makeWanted(sector);
    _data.wanted.push(w);
    save();
    return w;
  }

  /**
   * HE IS WANTED AGAIN, AND DEARER (update67).
   *
   * A prisoner who works his cell door open goes back on the board.
   * The yard raises what it will pay, because a man who has already
   * slipped one crew is a man nobody else wants to go after either —
   * and because the player has just paid for him twice over in
   * rations and a powered cell.
   *
   * Returns the poster, or null when the board is full: the ceiling
   * still holds. His state resets to `wanted` — a sighting from the
   * run he was CAUGHT on is no sighting of where he is now.
   */
  function reWanted(rec) {
    if (!_data || !rec) return null;
    _data.wanted = _data.wanted ?? [];
    // Already up there (he was never handed in) — he just gets worse.
    const known = _data.wanted.find(w => w.id === rec.wantedId);
    const raise = (v) => Math.round((v || 0) * ESCAPE_BOUNTY_RAISE);
    if (known) {
      _harden(known);
      known.bounty = raise(known.bounty);
      known.state  = 'wanted';
      save();
      return known;
    }
    if (_data.wanted.length >= WANTED_MAX) return null;
    const w = {
      id: rec.wantedId || `w${Utils.uid()}`,
      name: rec.name || 'Escaped Prisoner',
      race: rec.race || ((typeof CORP_KEYS !== 'undefined') ? Utils.pick(CORP_KEYS) : 'terra'),
      level: rec.level ?? 5,
      bounty: raise(rec.bounty || wantedBounty(5)),
      state: 'wanted',
      region: _data?.run?.region ?? DEFAULT_REGION,
      escapes: 0,
    };
    _harden(w);
    _data.wanted.push(w);
    save();
    return w;
  }

  /** Seen out there. Records WHERE, because that is what the list is
   *  for — and does NOT touch a man already handed in. */
  function markSighted(id, region = null) {
    const w = wantedById(id);
    /* NO `delivered` GUARD HERE, deliberately. A man who has been
       handed in is spliced OUT of the list, so `wantedById` already
       answers null for him — a state check as well would be a second
       guard for a state nothing ever sets, and the breaking run
       rightly reported it as code that could not be broken. */
    if (!w) return false;
    w.state  = 'sighted';
    w.region = region ?? _data?.run?.region ?? w.region;
    /* AND HOW DEEP. The board said "last seen: Luna", which is the
       whole moon — too coarse to plan a run around now that a poster
       sits on an actual node. */
    w.sector = _data?.run?.sector ?? w.sector ?? null;
    save();
    return true;
  }

  /** Handed in at the dock. He LEAVES the list — a delivered pirate
   *  that stayed on it would be found on the map again, which is the
   *  bug the design asks for a test against. Returns what he paid. */
  function deliverWanted(id, paid = 0) {
    if (!_data || !Array.isArray(_data.wanted)) return 0;
    const i = _data.wanted.findIndex(w => w.id === id);
    if (i < 0) return 0;
    _data.wanted.splice(i, 1);
    save();
    return Math.max(0, Math.round(paid));
  }

  /* ── REGIONS (update56) ───────────────────────────────────
   *
   * The map had no notion of WHERE it was. Three contracts existed
   * without an address, which was fine while there was one place to
   * fly — and would have meant migrating every save the day a second
   * moon appeared. One field now, while it costs one field.
   *
   * `luna` is the only region there is, and the demo adds no others.
   * `REGIONS` is the table the map and the Moon Gate both read; a
   * region is UNLOCKED or it is not, and the Gate is what unlocks the
   * rest, in the full version.
   */
  const REGIONS = {
    luna: { key: 'luna', label: 'LUNA', home: true, body: 'Earth',
            blurb: 'Our own Moon. Every contract in this version flies here.' },
    /* ── THE OTHER MOONS (update58) ───────────────────────────
     *
     * Listed, named and SHUT. The player asked to see where the Moon
     * Gate leads, and a locked door with nothing behind it is not a
     * promise — it is a blank wall. These are real moons of the outer
     * system with one line each about why anybody would fly there.
     *
     * `locked: true` is the whole of their behaviour in the demo:
     * `unlockedRegions` holds only Luna, no contract can name them, and
     * the Gate screen draws them greyed. When the Gate is buildable it
     * is `unlockedRegions` that grows — one register, already in the
     * save since update56.
     */
    europa:    { key: 'europa',    label: 'EUROPA',    body: 'Jupiter', locked: true,
                 blurb: 'Ice over an ocean. The drilling consortiums got there first.' },
    io:        { key: 'io',        label: 'IO',        body: 'Jupiter', locked: true,
                 blurb: 'Four hundred volcanoes and the richest sulphur yields anywhere.' },
    ganymede:  { key: 'ganymede',  label: 'GANYMEDE',  body: 'Jupiter', locked: true,
                 blurb: 'The largest moon in the system, and the only one with a magnetic field.' },
    titan:     { key: 'titan',     label: 'TITAN',     body: 'Saturn',  locked: true,
                 blurb: 'Methane seas under an orange sky. Nothing else out here has weather.' },
    enceladus: { key: 'enceladus', label: 'ENCELADUS', body: 'Saturn',  locked: true,
                 blurb: 'Geysers of clean water — the refuelling stop everyone is fighting over.' },
    triton:    { key: 'triton',    label: 'TRITON',    body: 'Neptune', locked: true,
                 blurb: 'Orbits backwards, freezing, and further out than the law reaches.' },
  };
  const DEFAULT_REGION = 'luna';

  function _defaultRun() {
    return {
      // Which moon we are flying over. See REGIONS above.
      region:    DEFAULT_REGION,
      // Map progress
      sector:    1,
      nodeIndex: 0,
      visited:   [],

      /* WHERE THE PLAYER IS STANDING in the current sector:
       *   { currentId: 'n7', visited: ['n0','n3','n7'] }
       * The layout is rebuilt from (sector, seed, lane), which is
       * deterministic — this is the piece that was missing, which is
       * why a reload mid-contract made you fly the sector again.
       * Written by game.js _saveShip, cleared by _nextSector. */
      mapProgress: null,

      // Player ship state (serialised by Ship.serialise())
      ship: null,

      // Persistent scrap for this run
      scrap: 50,

      // Fuel
      fuel: 10,

      // Missiles
      missiles: 8,

      // Active crew (serialised by Crew.serialise())
      crew: [],

      // Installed weapons (weapon def names)
      weapons: [],

      // Installed systems (system names)
      systems: [],

      // Reactor power
      reactorLevel: 2,   // module level (legacy field, ship.serialise is the source of truth)

      seed: Math.floor(Math.random() * 1e9),
    };
  }

  function _defaultSettings() {
    return {
      masterVolume: 0.8,
      sfxVolume:    1.0,
      musicVolume:  0.35,
      muted:        false,
      fullscreen:   false,
    };
  }

  // ── Load / save ───────────────────────────────────────────

  let _data     = null;
  let _settings = null;

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      _data = raw ? JSON.parse(raw) : _defaultSave();
    } catch(e) {
      console.warn('[Save] Failed to parse save, resetting:', e);
      _data = _defaultSave();
    }

    /* MIGRATION: a save written before update56 has no region, on the
       run or in the base. It is Luna — there has never been anywhere
       else — and writing it in on load means nothing downstream has to
       keep asking "what if it is missing". Exactly the shape of the
       captain → commander migration in update52. */
    if (_data && _data.run && !_data.run.region) _data.run.region = DEFAULT_REGION;
    if (_data && !Array.isArray(_data.unlockedRegions)) {
      _data.unlockedRegions = [DEFAULT_REGION];
    }
    /* A SAVE FROM BEFORE THE LIST GETS ONE NAME ON IT (update64).
       The design is explicit: the hunt starts with a single pirate.
       Written in on load, like the region above, so nothing downstream
       has to keep asking "what if there is no list". ONLY when the
       field is missing — see the note in `_defaultSave`. */
    _seedWanted();

    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      _settings = raw ? { ..._defaultSettings(), ...JSON.parse(raw) } : _defaultSettings();
    } catch(e) {
      _settings = _defaultSettings();
    }
  }

  /** The region table, and the one the player is flying in. */
  function regions() { return REGIONS; }
  function currentRegion() {
    return REGIONS[_data?.run?.region] || REGIONS[DEFAULT_REGION];
  }
  function unlockedRegions() {
    return [...(_data?.unlockedRegions ?? [DEFAULT_REGION])];
  }
  /** Is this moon open to fly to? Only Luna is, in this version — and
   *  the answer comes from the save, never from the table, so the day
   *  the Gate opens one there is nothing else to change. */
  function regionUnlocked(key) { return unlockedRegions().includes(key); }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(_data));
    } catch(e) {
      console.error('[Save] Failed to write save:', e);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(_settings));
    } catch(e) {
      console.error('[Save] Failed to write settings:', e);
    }
  }

  function reset() {
    _data = _defaultSave();
    _seedWanted();
    save();
  }

  // ── Run management ────────────────────────────────────────

  function startRun() {
    _data.run = _defaultRun();
    _data.stats.runs++;
    save();
  }

  function endRun(victory) {
    if (!_data.run) return;
    if (victory) {
      _data.stats.victories++;
    } else {
      _data.stats.deaths++;
    }

    // Record score
    const score = {
      sector:  _data.run.sector,
      scrap:   _data.run.scrap,
      victory,
      date: Date.now(),
    };
    _data.highScores.push(score);
    _data.highScores.sort((a, b) => b.sector - a.sector || b.scrap - a.scrap);
    _data.highScores = _data.highScores.slice(0, 10);

    _data.run = null;
    save();
  }

  function hasActiveRun() {
    return _data.run !== null;
  }

  /**
   * IS A HULL ACTUALLY OUT THERE? (update57)
   *
   * `hasActiveRun` is true the instant a run RECORD exists — which is
   * also true for a blank record that no contract has started on yet.
   * The question the base needs answered is narrower and harder: has a
   * ship been checked out of the hangar and not come back? `shipKey` is
   * written by `_startContract` and by nothing else, so it is the mark
   * of a contract that took a hull with it.
   *
   * This is what CONTINUE offers to return to, and what LAUNCH warns
   * about writing off. Getting it wrong in either direction is bad: too
   * loose and the player is asked "are you sure" before his first
   * flight of the session; too tight and a hull is written off in
   * silence.
   */
  function hasShipInFlight() {
    return !!(_data.run && _data.run.shipKey);
  }

  function getRun() { return _data.run; }

  function updateRun(partial) {
    if (!_data.run) return;
    Object.assign(_data.run, partial);
    save();
  }

  // ── Graveyard ─────────────────────────────────────────────

  function addToGraveyard(crewMember) {
    _data.graveyard.push({
      /* HIS ID (update68). `markBuried` had only his NAME to match on,
         which works because names are unique — but a burial is a
         payment, and paying the wrong headstone because two campaigns
         apart shared a name is not a risk worth carrying. */
      id:      crewMember.id ?? null,
      /* WHAT HE WAS. A cat is crew and dies like crew, but the list of
         those who never came home should not read as if you lost four
         hands when one of them had whiskers. */
      pet:     !!crewMember.isPet,
      name:    crewMember.name,
      race:    crewMember.race,
      skills:  Utils.deepClone(crewMember.skills),
      killed:  Date.now(),
      sector:  _data.run ? _data.run.sector : 0,
      mission: _data.run ? _data.run.mission : null,
      killer:  crewMember.killedBy || 'unknown',
      // The service record goes on the headstone with them.
      battles: crewMember.battles ?? 0,
      wins:    crewMember.wins    ?? 0,
      escapes: crewMember.escapes ?? 0,
      kills:   crewMember.kills   ?? 0,
    });

    // Keep the last 200 — the hill is the point, and 50 filled up in
    // a couple of campaigns.
    if (_data.graveyard.length > 200) {
      _data.graveyard = _data.graveyard.slice(-200);
    }
    save();
  }

  function getGraveyard() { return _data.graveyard; }

  /**
   * A COMMANDER HAS NO BODY TO BURY (update68).
   *
   * He is a record, not a CrewMember, so nothing ever put him on the
   * memorial — a man could lose four commanders across a campaign and
   * the hill would not know any of them existed. He goes on the SAME
   * list as everybody else (there is only one memorial), marked so the
   * screen can say what he was, and never `buried`: a commander lost
   * with his ship is by definition not coming home.
   */
  function addCommanderToGraveyard(cap) {
    if (!cap || !_data) return false;
    _data.graveyard = _data.graveyard ?? [];
    _data.graveyard.push({
      id: cap.id ?? null, name: cap.name, race: cap.race,
      skills: {}, killed: Date.now(),
      sector: _data.run ? _data.run.sector : 0,
      mission: _data.run ? _data.run.mission : null,
      killer: 'lost with the ship',
      battles: 0, wins: 0, escapes: 0, kills: 0,
      commander: true, level: cap.level ?? 1,
    });
    save();
    return true;
  }

  /** Everybody the memorial knows whose body never came home. The
   *  graveyard is the ONE list; this is a reading of it, not a second
   *  register — a man moves off it by being carried back, nothing else. */
  function notRecovered() {
    return (_data?.graveyard ?? []).filter(g => g && !g.buried);
  }

  /**
   * HE CAME HOME (update65).
   *
   * A field on the record the graveyard ALREADY has, not a second
   * list: `addToGraveyard` fires the moment a man dies, so the
   * memorial knows every name. What it could not know is which of
   * them was brought back instead of blown out a hatch, and that is
   * the one fact a burial adds.
   *
   * Matched on id first and name second, because a body bagged in an
   * old save may carry only the name. Marking a man who is already
   * marked does nothing — the dock can be reached twice.
   */
  function markBuried(id, name) {
    const list = _data?.graveyard;
    if (!Array.isArray(list)) return false;
    const rec = list.find(g => g && ((id && g.id === id) || (!id && name && g.name === name)))
             || list.find(g => g && name && g.name === name);
    if (!rec || rec.buried) return false;
    rec.buried = true;
    save();
    return true;
  }

  // ── Scrap bank (cross-run) ────────────────────────────────

  function addScrapBank(amount) {
    _data.scrapBank  += amount;
    _data.stats.scrapEarned += amount;
    save();
  }

  function spendScrapBank(amount) {
    if (_data.scrapBank < amount) return false;
    _data.scrapBank -= amount;
    save();
    return true;
  }

  function getScrapBank() { return _data.scrapBank; }

  // ── Unlocks ───────────────────────────────────────────────

  function unlock(category, id) {
    if (!_data.unlocks[category]) _data.unlocks[category] = [];
    if (!_data.unlocks[category].includes(id)) {
      _data.unlocks[category].push(id);
      save();
      return true;
    }
    return false;
  }

  function isUnlocked(category, id) {
    return (_data.unlocks[category] || []).includes(id);
  }

  function getUnlocks() { return _data.unlocks; }

  // ── Stats ─────────────────────────────────────────────────

  function recordKill()   { _data.stats.enemiesKilled++; }
  function getStats()     { return _data.stats; }
  function getHighScores(){ return _data.highScores; }

  // ── Settings ─────────────────────────────────────────────

  function getSetting(key)        { return _settings[key]; }
  function setSetting(key, value) { _settings[key] = value; saveSettings(); }
  function getSettings()          { return _settings; }

  /** Set without touching localStorage — for a slider being dragged.
   *  The options screen calls saveSettings() once, on release. */
  function setSettingLive(key, value) { _settings[key] = value; }

  /** Raw save blob. base.js keeps its persistent state INSIDE it, so
   *  the whole game is still one localStorage record to migrate. */
  function getRaw() { return _data; }

  // ── Public API ───────────────────────────────────────────

  return {
    load, save, saveSettings, reset, getRaw,
    startRun, endRun, hasActiveRun, hasShipInFlight, getRun, updateRun,
    addToGraveyard, addCommanderToGraveyard, getGraveyard, markBuried, notRecovered,
    addScrapBank, spendScrapBank, getScrapBank,
    unlock, isUnlocked, getUnlocks,
    recordKill, getStats, getHighScores,
    getSetting, setSetting, setSettingLive, getSettings,
    // Regions (update56)
    REGIONS, DEFAULT_REGION, regions, currentRegion, unlockedRegions, regionUnlocked,
    // The wanted list (update64)
    WANTED_MAX, ESCAPE_BOUNTY_RAISE, ESCAPE_LEVEL_GAIN,
    wanted, wantedById, addWanted, markSighted,
    deliverWanted, reWanted,
    wantedBounty, makeWanted,
  };

})();
