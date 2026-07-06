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
    };
  }

  function _defaultRun() {
    return {
      // Map progress
      sector:    1,
      nodeIndex: 0,
      visited:   [],

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

    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      _settings = raw ? { ..._defaultSettings(), ...JSON.parse(raw) } : _defaultSettings();
    } catch(e) {
      _settings = _defaultSettings();
    }
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
      killer:  crewMember.killedBy || 'unknown',
    });

    // Keep last 50 entries
    if (_data.graveyard.length > 50) {
      _data.graveyard = _data.graveyard.slice(-50);
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

  // ── Public API ───────────────────────────────────────────

  return {
    load, save, saveSettings, reset,
    startRun, endRun, hasActiveRun, getRun, updateRun,
    addToGraveyard, getGraveyard,
    addScrapBank, spendScrapBank, getScrapBank,
    unlock, isUnlocked, getUnlocks,
    recordKill, getStats, getHighScores,
    getSetting, setSetting, getSettings,
  };

})();
