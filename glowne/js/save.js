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
    };
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
    luna: { key: 'luna', label: 'LUNA', home: true,
            blurb: 'Our own Moon. Everything the demo contains happens here.' },
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
    addToGraveyard, getGraveyard,
    addScrapBank, spendScrapBank, getScrapBank,
    unlock, isUnlocked, getUnlocks,
    recordKill, getStats, getHighScores,
    getSetting, setSetting, setSettingLive, getSettings,
    // Regions (update56)
    REGIONS, DEFAULT_REGION, regions, currentRegion, unlockedRegions,
  };

})();
