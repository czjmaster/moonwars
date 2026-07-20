/* ============================================================
   MOON WARS — audio.js
   Web Audio API sound manager.
   Procedural synthesis for all SFX (no external files needed).
   Music: simple procedural loop system.
   ============================================================ */

'use strict';

const Audio = (() => {

  let ctx = null;
  let masterGain = null;
  let sfxGain    = null;
  let musicGain  = null;
  let musicNode  = null;
  let _enabled   = true;

  // ── Init ─────────────────────────────────────────────────

  function init() {
    try {
      ctx         = new (window.AudioContext || window.webkitAudioContext)();
      masterGain  = ctx.createGain();
      sfxGain     = ctx.createGain();
      musicGain   = ctx.createGain();
      masterGain.gain.value = 0.8;
      sfxGain.gain.value    = 1.0;
      musicGain.gain.value  = 0.35;
      sfxGain.connect(masterGain);
      musicGain.connect(masterGain);
      masterGain.connect(ctx.destination);
    } catch(e) {
      console.warn('[Audio] Web Audio not available:', e);
      _enabled = false;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ── Low-level synthesis helpers ───────────────────────────

  function _tone({ freq = 440, type = 'sine', duration = 0.1,
                   gain = 0.3, attack = 0.005, decay = 0,
                   sustain = 1, release = 0.05,
                   freqEnd = null, destination = null, when = 0 }) {
    if (!_enabled || !ctx) return;
    const dest = destination || sfxGain;
    const now  = Math.max(ctx.currentTime, when || ctx.currentTime);

    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(freqEnd, 1), now + duration
      );
    }

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + attack);
    if (decay > 0) {
      env.gain.linearRampToValueAtTime(gain * sustain, now + attack + decay);
    }
    env.gain.setValueAtTime(gain * sustain, now + duration - release);
    env.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(env);
    env.connect(dest);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  function _noise({ duration = 0.1, gain = 0.2, hpFreq = 200,
                    attack = 0.002, release = 0.05, destination = null }) {
    if (!_enabled || !ctx) return;
    const dest = destination || sfxGain;
    const now  = ctx.currentTime;
    const len  = Math.ceil(ctx.sampleRate * (duration + 0.1));
    const buf  = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src    = ctx.createBufferSource();
    const hp     = ctx.createBiquadFilter();
    const env    = ctx.createGain();
    src.buffer   = buf;
    hp.type      = 'highpass';
    hp.frequency.value = hpFreq;

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + attack);
    env.gain.setValueAtTime(gain, now + duration - release);
    env.gain.linearRampToValueAtTime(0, now + duration);

    src.connect(hp);
    hp.connect(env);
    env.connect(dest);
    src.start(now);
    src.stop(now + duration + 0.1);
  }

  // ── Sound library ─────────────────────────────────────────

  const SFX = {

    weaponFire() {
      _tone({ freq: 180, freqEnd: 80, type: 'sawtooth', duration: 0.18, gain: 0.4, attack: 0.003, release: 0.12 });
      _noise({ duration: 0.12, gain: 0.15, hpFreq: 1200 });
    },

    weaponCharge() {
      _tone({ freq: 400, freqEnd: 1200, type: 'sine', duration: 0.6, gain: 0.15, attack: 0.01, release: 0.1 });
    },

    explosion() {
      _noise({ duration: 0.6, gain: 0.5, hpFreq: 40, attack: 0.003, release: 0.5 });
      _tone({ freq: 60, freqEnd: 20, type: 'sawtooth', duration: 0.4, gain: 0.4, attack: 0.002, release: 0.35 });
    },

    shieldHit() {
      _tone({ freq: 800, freqEnd: 300, type: 'sine', duration: 0.25, gain: 0.35, attack: 0.003, release: 0.2 });
    },

    shieldRecharge() {
      _tone({ freq: 300, freqEnd: 600, type: 'sine', duration: 0.3, gain: 0.2, attack: 0.005, release: 0.1 });
      _tone({ freq: 450, freqEnd: 900, type: 'sine', duration: 0.3, gain: 0.15, attack: 0.02, release: 0.1 });
    },

    hullBreach() {
      _noise({ duration: 0.4, gain: 0.4, hpFreq: 600, attack: 0.001, release: 0.3 });
      _tone({ freq: 200, freqEnd: 50, type: 'sawtooth', duration: 0.3, gain: 0.3, attack: 0.002, release: 0.25 });
    },

    fireStart() {
      _noise({ duration: 0.3, gain: 0.25, hpFreq: 800, attack: 0.01, release: 0.2 });
    },

    repair() {
      _tone({ freq: 600, type: 'square', duration: 0.08, gain: 0.15, attack: 0.005, release: 0.05 });
      _tone({ freq: 900, type: 'square', duration: 0.08, gain: 0.12, attack: 0.005, release: 0.05 });
    },

    uiClick() {
      _tone({ freq: 900, type: 'square', duration: 0.06, gain: 0.2, attack: 0.002, release: 0.04 });
    },

    uiHover() {
      _tone({ freq: 1200, type: 'sine', duration: 0.04, gain: 0.08, attack: 0.002, release: 0.03 });
    },

    crewDie() {
      _tone({ freq: 400, freqEnd: 100, type: 'sine', duration: 0.5, gain: 0.3, attack: 0.005, release: 0.4 });
    },

    scrapCollect() {
      _tone({ freq: 1000, freqEnd: 1400, type: 'sine', duration: 0.12, gain: 0.25, attack: 0.003, release: 0.08 });
    },

    oxygenLow() {
      _tone({ freq: 220, type: 'sine', duration: 0.4, gain: 0.2, attack: 0.01, release: 0.15 });
    },

    powerUp() {
      [300, 450, 600].forEach((f, i) => {
        setTimeout(() => _tone({ freq: f, type: 'sine', duration: 0.15, gain: 0.2, attack: 0.005, release: 0.1 }), i * 80);
      });
    },

    levelUp() {
      [400, 600, 800, 1200].forEach((f, i) => {
        setTimeout(() => _tone({ freq: f, type: 'sine', duration: 0.18, gain: 0.25, attack: 0.005, release: 0.1 }), i * 100);
      });
    },

    bossWarning() {
      _tone({ freq: 80, type: 'sawtooth', duration: 1.0, gain: 0.35, attack: 0.05, release: 0.5 });
      _noise({ duration: 0.5, gain: 0.2, hpFreq: 300, attack: 0.01, release: 0.4 });
    },
  };

  // ── Procedural music ──────────────────────────────────────

  const _musicNotes = {
    combat:   [110, 130, 165, 196, 220, 165, 196, 146,
               110, 146, 174, 220, 196, 165, 130, 123],
    explore:  [220, 261, 293, 329, 261, 220, 196, 220,
               174, 220, 261, 293, 349, 293, 261, 246],
    station:  [330, 392, 440, 523, 392, 330, 293, 330,
               349, 440, 523, 587, 523, 440, 392, 349],
    boss:     [73,  87,  110, 87,  73,  55,  73,  82,
               65,  82,  98,  110, 87,  73,  65,  55],
  };

  let _musicTimer    = null;
  let _musicBeat     = 0;
  let _musicMode     = null;
  let _musicRunning  = false;

  function playMusic(mode = 'explore') {
    if (!_enabled || !ctx) return;
    if (_musicMode === mode && _musicRunning) return;
    if (_musicTimer) { clearTimeout(_musicTimer); _musicTimer = null; }
    _musicMode    = mode;
    _musicRunning = true;
    _musicBeat    = 0;
    _nextNoteTime = 0;
    if (musicGain) musicGain.gain.value = 0.35;   // cancel any fade-out
    _scheduleBeat();
  }

  function stopMusic(fade = 1.0) {
    _musicRunning = false;
    if (_musicTimer) { clearTimeout(_musicTimer); _musicTimer = null; }
    if (musicGain) {
      const now = ctx.currentTime;
      musicGain.gain.linearRampToValueAtTime(0, now + fade);
      setTimeout(() => { if (musicGain) musicGain.gain.value = 0.35; }, (fade + 0.1) * 1000);
    }
  }

  let _nextNoteTime = 0;

  function _scheduleBeat() {
    if (!_musicRunning || !ctx) return;
    const notes    = _musicNotes[_musicMode] || _musicNotes.explore;
    const interval = (_musicMode === 'boss' ? 300 : 500) / 1000;

    if (_nextNoteTime < ctx.currentTime) _nextNoteTime = ctx.currentTime + 0.05;

    // Queue every note that falls inside the 0.35s lookahead window at
    // its EXACT audio-clock time — a busy render frame can no longer
    // delay or double-trigger a beat.
    let _guard = 0;   // FREEZE GUARD: hard bound on queued notes
    while (_nextNoteTime < ctx.currentTime + 0.35 && _guard++ < 64) {
      const note = notes[_musicBeat % notes.length];
      _tone({
        freq: note, freqEnd: note * 0.98,
        type: 'triangle', duration: 0.4,
        gain: 0.22, attack: 0.01, release: 0.3,
        destination: musicGain, when: _nextNoteTime,
      });
      if (_musicBeat % 4 === 0) {
        _tone({
          freq: note / 2, type: 'sine', duration: 0.7,
          gain: 0.28, attack: 0.02, release: 0.55,
          destination: musicGain, when: _nextNoteTime,
        });
      }
      _musicBeat++;
      _nextNoteTime += interval;
    }

    _musicTimer = setTimeout(_scheduleBeat, 100);
  }

  // ── Volume controls ───────────────────────────────────────

  function setMasterVolume(v) { if (masterGain) masterGain.gain.value = Utils.clamp(v, 0, 1); }
  function setSfxVolume(v)    { if (sfxGain)    sfxGain.gain.value    = Utils.clamp(v, 0, 1); }
  function setMusicVolume(v)  { if (musicGain)  musicGain.gain.value  = Utils.clamp(v, 0, 1); }

  // ── Public API ───────────────────────────────────────────

  return {
    init,
    resume,
    sfx: SFX,
    playMusic,
    stopMusic,
    setMasterVolume,
    setSfxVolume,
    setMusicVolume,
  };

})();
