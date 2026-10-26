/* ============================================================
   MOON WARS — audio.js
   Web Audio API sound manager.
   Procedural synthesis for all SFX (no external files needed).

   MUSIC (update172): a small band in code — pad, bass, drums, a lead
   and an arpeggio — playing a song per mode (explore / station /
   combat / boss). The layers come and go with the TENSION of the
   moment (0 calm, 1 engaged, 2 "źle": hull low, fire, a breach,
   boarders), a mode change crossfades instead of cutting, and short
   STINGERS mark the moments that matter (victory, defeat, the jump,
   a port, a job paid, boarders, a tractor lock, a contract won).
   A real track (OGG) can be dropped in per mode — see MUSIC_FILES.
   ============================================================ */

'use strict';

const Audio = (() => {

  let ctx = null;
  let masterGain  = null;
  let sfxGain     = null;
  let musicGain   = null;
  let duckGain    = null;   // songs → duck → music (a stinger ducks the song)
  let stingerGain = null;   // stingers → master, at the music level
  let compressor  = null;   // master → compressor → speakers
  let _enabled    = true;

  // ── Init ─────────────────────────────────────────────────

  function init() {
    try {
      ctx         = new (window.AudioContext || window.webkitAudioContext)();
      masterGain  = ctx.createGain();
      sfxGain     = ctx.createGain();
      musicGain   = ctx.createGain();
      duckGain    = ctx.createGain();
      stingerGain = ctx.createGain();
      masterGain.gain.value  = 0.8;
      sfxGain.gain.value     = 1.0;
      musicGain.gain.value   = 0.35;
      duckGain.gain.value    = 1.0;
      stingerGain.gain.value = _stingerLevel();
      sfxGain.connect(masterGain);
      duckGain.connect(musicGain);
      musicGain.connect(masterGain);
      stingerGain.connect(masterGain);
      /* A whole band plus a broadside of guns can sum past 1.0 — the
         compressor keeps the loud moments loud instead of clipped. */
      if (ctx.createDynamicsCompressor) {
        compressor = ctx.createDynamicsCompressor();
        try {
          compressor.threshold.value = -10; compressor.knee.value = 8;
          compressor.ratio.value = 4; compressor.attack.value = 0.004;
          compressor.release.value = 0.2;
        } catch (e) { /* a stub without params is fine */ }
        masterGain.connect(compressor);
        compressor.connect(ctx.destination);
      } else {
        masterGain.connect(ctx.destination);
      }
      Object.entries(MUSIC_FILES).forEach(([m, url]) => setTrack(m, url));
    } catch(e) {
      console.warn('[Audio] Web Audio not available:', e);
      _enabled = false;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ── Low-level synthesis helpers ───────────────────────────

  /* ── HUSH (update138) ─────────────────────────────────────
     * Code that SIMULATES a ship rather than playing one — the hangar's
     * preview runs up to 40 s of her life in one frame so the crew are at
     * their posts in the picture — must not be heard. Every gun arming,
     * every shield bar and door in that run used to play at once: jj,
     * "strasznie wyje ta osłona", "dźwięki się powtarzają jakby się
     * zacinały". Inside `hush(fn)` nothing sounds. */
  let _hush = 0;
  function hush(fn) {
    _hush++;
    try { return fn(); } finally { _hush--; }
  }
  function hushed() { return _hush > 0; }

  function _tone({ freq = 440, type = 'sine', duration = 0.1,
                   gain = 0.3, attack = 0.005, decay = 0,
                   sustain = 1, release = 0.05, detune = 0,
                   freqEnd = null, destination = null, when = 0 }) {
    if (!_enabled || !ctx || _hush > 0) return;
    const dest = destination || sfxGain;
    const now  = Math.max(ctx.currentTime, when || ctx.currentTime);
    // the release never starts before the attack is over (update172)
    const rel  = Math.min(release, Math.max(0.005, duration - attack - decay));

    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (detune && osc.detune) osc.detune.value = detune;
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
    env.gain.setValueAtTime(gain * sustain, now + duration - rel);
    env.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(env);
    env.connect(dest);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  /* ONE NOISE BUFFER (update172). Every burst of noise used to fill a
     fresh buffer with Math.random — fine for a door, not for a hi-hat
     sixteen times a bar. One two-second buffer, read from a random
     place each time, sounds the same and costs nothing. */
  let _noiseBuf = null;
  function _noiseBuffer() {
    if (_noiseBuf) return _noiseBuf;
    const len = Math.ceil(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return (_noiseBuf = buf);
  }

  function _noise({ duration = 0.1, gain = 0.2, hpFreq = 200,
                    filter = 'highpass', freq = null, freqEnd = null, Q = 0.7,
                    attack = 0.002, release = 0.05, destination = null, when = 0 }) {
    if (!_enabled || !ctx || _hush > 0) return;
    const dest = destination || sfxGain;
    const now  = Math.max(ctx.currentTime, when || ctx.currentTime);
    const rel  = Math.min(release, Math.max(0.005, duration - attack));

    const src  = ctx.createBufferSource();
    const flt  = ctx.createBiquadFilter();
    const env  = ctx.createGain();
    src.buffer = _noiseBuffer();
    flt.type   = filter;
    const f0   = freq ?? hpFreq;
    flt.frequency.setValueAtTime(f0, now);
    if (freqEnd !== null) flt.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), now + duration);
    if (flt.Q) flt.Q.value = Q;

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + attack);
    env.gain.setValueAtTime(gain, now + duration - rel);
    env.gain.linearRampToValueAtTime(0, now + duration);

    src.connect(flt);
    flt.connect(env);
    env.connect(dest);
    src.start(now, Math.random() * 1.5);
    src.stop(now + duration + 0.05);
  }

  // ── Sound library ─────────────────────────────────────────

  /* EVERY GUN ITS OWN VOICE (update172). One sawtooth thunk was every
     weapon in the game; a flak burst and a torpedo sounded alike. The
     voice is chosen from the gun's TYPE (the heavy laser by its key),
     and the name is returned so the tests can ask which one played. */
  const FIRE_VOICES = ['laser', 'heavy', 'ion', 'missile', 'torpedo', 'cannon', 'flak', 'beam'];
  function fireVoice(type, key) {
    if (key === 'laser_heavy' || type === 'laser_heavy') return 'heavy';
    return FIRE_VOICES.includes(type) ? type : 'laser';
  }

  /* …and every kind of hit its own (update172). The kinds are
     WeaponArt.hitKind's, so the blast you see and the blast you hear
     are the same blast. 'armour' is a bolt ringing off the plate. */
  const IMPACT_VOICES = ['laser', 'heavy', 'ion', 'missile', 'torpedo', 'cannon', 'flak', 'armour'];
  function impactVoice(kind) {
    return IMPACT_VOICES.includes(kind) ? kind : 'laser';
  }

  const SFX = {

    weaponFire(type = 'laser', key = null) {
      const v = fireVoice(type, key);
      switch (v) {
        case 'heavy':
          _tone({ freq: 560, freqEnd: 110, type: 'sawtooth', duration: 0.28, gain: 0.30, attack: 0.003, release: 0.2 });
          _tone({ freq: 280, freqEnd: 70, type: 'square', duration: 0.22, gain: 0.12, attack: 0.003, release: 0.16 });
          _noise({ duration: 0.14, gain: 0.12, hpFreq: 1500 });
          break;
        case 'ion':
          _tone({ freq: 300, freqEnd: 1400, type: 'sine', duration: 0.24, gain: 0.18, attack: 0.004, release: 0.12 });
          _tone({ freq: 1500, freqEnd: 600, type: 'sine', duration: 0.2, gain: 0.08, attack: 0.03, release: 0.12 });
          _noise({ duration: 0.22, gain: 0.09, filter: 'bandpass', freq: 3500, Q: 2.5, release: 0.15 });
          break;
        case 'missile':
          _tone({ freq: 120, freqEnd: 50, type: 'sine', duration: 0.2, gain: 0.32, attack: 0.002, release: 0.15 });
          _noise({ duration: 0.6, gain: 0.2, filter: 'bandpass', freq: 400, freqEnd: 2400, Q: 1.2, attack: 0.02, release: 0.35 });
          break;
        case 'torpedo':
          _tone({ freq: 75, freqEnd: 32, type: 'sine', duration: 0.45, gain: 0.42, attack: 0.004, release: 0.35 });
          _noise({ duration: 0.9, gain: 0.22, filter: 'lowpass', freq: 300, freqEnd: 1500, attack: 0.05, release: 0.55 });
          break;
        case 'cannon':
          _tone({ freq: 100, freqEnd: 38, type: 'sine', duration: 0.38, gain: 0.48, attack: 0.002, release: 0.3 });
          _noise({ duration: 0.32, gain: 0.32, filter: 'lowpass', freq: 1400, freqEnd: 200, attack: 0.002, release: 0.26 });
          break;
        case 'flak':
          for (let i = 0; i < 3; i++) {
            const at = ctx ? ctx.currentTime + i * 0.06 : 0;
            _noise({ duration: 0.08, gain: 0.2, filter: 'bandpass', freq: 1300 + i * 250, Q: 1, release: 0.06, when: at });
            _tone({ freq: 320, freqEnd: 120, type: 'square', duration: 0.06, gain: 0.07, release: 0.05, when: at });
          }
          break;
        case 'beam':
          _tone({ freq: 140, type: 'sawtooth', duration: 0.7, gain: 0.13, attack: 0.05, release: 0.25 });
          _tone({ freq: 1800, freqEnd: 1500, type: 'sine', duration: 0.7, gain: 0.05, attack: 0.05, release: 0.25 });
          break;
        default:   // laser
          _tone({ freq: 1400, freqEnd: 320, type: 'square', duration: 0.14, gain: 0.14, attack: 0.002, release: 0.1 });
          _tone({ freq: 700, freqEnd: 160, type: 'sawtooth', duration: 0.16, gain: 0.13, attack: 0.002, release: 0.12 });
          _noise({ duration: 0.06, gain: 0.07, hpFreq: 2500 });
      }
      return v;
    },

    weaponCharge() {
      _tone({ freq: 400, freqEnd: 1200, type: 'sine', duration: 0.6, gain: 0.15, attack: 0.01, release: 0.1 });
    },

    explosion() {
      _noise({ duration: 0.6, gain: 0.5, hpFreq: 40, attack: 0.003, release: 0.5 });
      _tone({ freq: 60, freqEnd: 20, type: 'sawtooth', duration: 0.4, gain: 0.4, attack: 0.002, release: 0.35 });
    },

    /** A shot landing on a hull (update172) — see IMPACT_VOICES. */
    hullImpact(kind = 'laser', dmg = 1) {
      const v = impactVoice(kind);
      const k = 1 + Math.min(4, Math.max(0, dmg)) * 0.1;
      switch (v) {
        case 'armour':     // a ring off the plate, nothing through
          _tone({ freq: 1250, freqEnd: 1180, type: 'square', duration: 0.28, gain: 0.06, attack: 0.002, release: 0.24 });
          _tone({ freq: 2650, type: 'sine', duration: 0.35, gain: 0.05, attack: 0.002, release: 0.3 });
          _noise({ duration: 0.05, gain: 0.1, hpFreq: 3000 });
          break;
        case 'ion':
          _noise({ duration: 0.3, gain: 0.14 * k, filter: 'bandpass', freq: 4200, Q: 3, release: 0.2 });
          _tone({ freq: 900, freqEnd: 2200, type: 'square', duration: 0.12, gain: 0.05, release: 0.08 });
          break;
        case 'flak':
          for (let i = 0; i < 4; i++) {
            const at = ctx ? ctx.currentTime + i * 0.035 : 0;
            _noise({ duration: 0.05, gain: 0.14 * k, hpFreq: 1800 + i * 300, release: 0.04, when: at });
          }
          break;
        case 'missile': case 'torpedo': case 'cannon': {
          const big = v === 'torpedo' ? 1.25 : v === 'cannon' ? 1.1 : 1;
          _noise({ duration: 0.55 * big, gain: 0.42 * k, filter: 'lowpass', freq: 2200, freqEnd: 120, attack: 0.002, release: 0.45 });
          _tone({ freq: 90, freqEnd: 28, type: 'sine', duration: 0.45 * big, gain: 0.5 * k, attack: 0.002, release: 0.38 });
          _tone({ freq: 160, freqEnd: 60, type: 'sawtooth', duration: 0.2, gain: 0.12 * k, attack: 0.002, release: 0.16 });
          break;
        }
        case 'heavy':
          _noise({ duration: 0.3, gain: 0.3 * k, hpFreq: 600, release: 0.25 });
          _tone({ freq: 220, freqEnd: 60, type: 'sawtooth', duration: 0.28, gain: 0.26 * k, attack: 0.002, release: 0.22 });
          break;
        default:   // laser: a sizzle on the plate
          _noise({ duration: 0.2, gain: 0.22 * k, hpFreq: 1200, release: 0.16 });
          _tone({ freq: 260, freqEnd: 90, type: 'sawtooth', duration: 0.18, gain: 0.18 * k, attack: 0.002, release: 0.14 });
      }
      return v;
    },

    /** A shot that went wide — the hiss of it going past. */
    shotMiss() {
      _noise({ duration: 0.28, gain: 0.09, filter: 'bandpass', freq: 2400, freqEnd: 600, Q: 1.5, attack: 0.03, release: 0.2 });
    },

    shieldHit() {
      _tone({ freq: 800, freqEnd: 300, type: 'sine', duration: 0.25, gain: 0.3, attack: 0.003, release: 0.2 });
      _tone({ freq: 1600, freqEnd: 700, type: 'sine', duration: 0.2, gain: 0.08, attack: 0.003, release: 0.16 });
      _noise({ duration: 0.18, gain: 0.07, filter: 'bandpass', freq: 3000, Q: 3, release: 0.14 });
    },

    shieldRecharge() {
      _tone({ freq: 300, freqEnd: 600, type: 'sine', duration: 0.3, gain: 0.2, attack: 0.005, release: 0.1 });
      _tone({ freq: 450, freqEnd: 900, type: 'sine', duration: 0.3, gain: 0.15, attack: 0.02, release: 0.1 });
    },

    hullBreach() {
      _noise({ duration: 0.4, gain: 0.4, hpFreq: 600, attack: 0.001, release: 0.3 });
      _tone({ freq: 200, freqEnd: 50, type: 'sawtooth', duration: 0.3, gain: 0.3, attack: 0.002, release: 0.25 });
      // …and the air going out after it (update172)
      _noise({ duration: 1.1, gain: 0.12, hpFreq: 3200, attack: 0.08, release: 0.8 });
    },

    /* GRAVITY (update91): a winding-down whine when it goes, a low
       mechanical thump when it comes back. Once per change, never looped. */
    /* REACTOR HEAT (update92): said once per crossing, never looped. */
    reactorWarn() {
      _tone({ freq: 520, type: 'square', duration: 0.12, gain: 0.15, attack: 0.005, release: 0.08 });
      _tone({ freq: 440, type: 'square', duration: 0.12, gain: 0.12, attack: 0.005, release: 0.08 });
    },

    reactorCritical() {
      for (let i = 0; i < 3; i++) {
        _tone({ freq: 880 - i * 120, type: 'sawtooth', duration: 0.16, gain: 0.2, attack: 0.005, release: 0.1 });
      }
    },

    reactorOverheat() {
      _noise({ duration: 0.5, gain: 0.45, hpFreq: 300, attack: 0.002, release: 0.4 });
      _tone({ freq: 140, freqEnd: 40, type: 'sawtooth', duration: 0.5, gain: 0.35, attack: 0.002, release: 0.4 });
    },

    gravityOff() {
      _tone({ freq: 420, freqEnd: 90, type: 'sawtooth', duration: 0.7, gain: 0.25, attack: 0.01, release: 0.4 });
    },

    gravityOn() {
      _tone({ freq: 70, freqEnd: 40, type: 'sine', duration: 0.25, gain: 0.5, attack: 0.002, release: 0.2 });
      _noise({ duration: 0.12, gain: 0.25, hpFreq: 200, attack: 0.002, release: 0.1 });
    },

    fireStart() {
      _noise({ duration: 0.3, gain: 0.25, hpFreq: 800, attack: 0.01, release: 0.2 });
      _noise({ duration: 0.5, gain: 0.12, filter: 'lowpass', freq: 600, attack: 0.05, release: 0.35 });
    },

    repair() {
      _tone({ freq: 600, type: 'square', duration: 0.08, gain: 0.15, attack: 0.005, release: 0.05 });
      _tone({ freq: 900, type: 'square', duration: 0.08, gain: 0.12, attack: 0.005, release: 0.05 });
    },

    uiClick() {
      _tone({ freq: 900, type: 'square', duration: 0.06, gain: 0.2, attack: 0.002, release: 0.04 });
    },

    /** One syllable of somebody talking on the event screen (update136):
     *  a short, quiet square blip at the speaker's own pitch. */
    voiceBlip(pitch = 1) {
      const f = 210 * pitch * (0.92 + Math.random() * 0.16);
      _tone({ freq: f, freqEnd: f * 0.86, type: 'square', duration: 0.045,
              gain: 0.05, attack: 0.003, release: 0.03 });
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

    /* THE JUMP (update118): the drive spooling up, then the tear. */
    ftlJump() {
      _tone({ freq: 90, freqEnd: 520, type: 'sine', duration: 1.1, gain: 0.22, attack: 0.2, release: 0.2 });
      setTimeout(() => {
        _tone({ freq: 900, freqEnd: 60, type: 'sawtooth', duration: 0.35, gain: 0.2, attack: 0.003, release: 0.3 });
        _noise({ duration: 0.3, gain: 0.18, hpFreq: 500, attack: 0.003, release: 0.25 });
      }, 1050);
    },
    /** A hull dropping out of a jump in front of you. */
    ftlArrive() {
      _tone({ freq: 1100, freqEnd: 180, type: 'sine', duration: 0.28, gain: 0.2, attack: 0.002, release: 0.2 });
    },

    /* ── SILENT CALLERS (update40) ─────────────────────────
       These three were called with `?.()` from ship.js, station.js and
       wreck.js and NONE of them existed, so optional chaining swallowed
       them and the game was quietly mute in three places: every door in
       the game, every purchase at a station, and a botched dock. That
       is what `?.` buys you — no crash, no sound, no clue. */

    /** A bulkhead door running on its track. */
    doorMove() {
      _tone({ freq: 260, freqEnd: 170, type: 'square', duration: 0.11,
              gain: 0.10, attack: 0.004, release: 0.07 });
      _noise({ duration: 0.09, gain: 0.05, hpFreq: 1800 });
    },

    /** A lift cabin settling at its floor (update172) — a soft clunk,
     *  quiet, and not more than a few a second however many lifts run. */
    liftStop() {
      if (!ctx) return;
      if (ctx.currentTime - _liftAt < 0.25) return;
      _liftAt = ctx.currentTime;
      _tone({ freq: 95, freqEnd: 60, type: 'sine', duration: 0.13, gain: 0.08, attack: 0.003, release: 0.1 });
      _noise({ duration: 0.06, gain: 0.04, filter: 'lowpass', freq: 700, release: 0.05 });
    },

    /** Coins into the slot at a station counter. */
    scrapPickup() {
      _tone({ freq: 1200, freqEnd: 1650, type: 'sine', duration: 0.09,
              gain: 0.2, attack: 0.002, release: 0.06 });
      _tone({ freq: 800, type: 'sine', duration: 0.06, gain: 0.12,
              attack: 0.002, release: 0.05 });
    },

    /** Metal on metal — a hard dock, a hull knock. */
    hullHit() {
      _tone({ freq: 140, freqEnd: 60, type: 'sawtooth', duration: 0.22,
              gain: 0.32, attack: 0.002, release: 0.18 });
      _noise({ duration: 0.16, gain: 0.22, hpFreq: 200, attack: 0.001, release: 0.14 });
    },

    /** Something chewing through a loom, then the loom letting go. */
    ratChew() {
      _noise({ duration: 0.18, gain: 0.12, hpFreq: 2600, attack: 0.005, release: 0.12 });
      _tone({ freq: 1500, freqEnd: 300, type: 'square', duration: 0.16,
              gain: 0.16, attack: 0.002, release: 0.12 });
    },
  };
  let _liftAt = -1;

  /**
   * Hover cue, edge-triggered.
   *
   * `uiHover` was defined on day one and never called once — every
   * button in the game highlights silently. It cannot simply be played
   * from a `hot` test, because that is true on EVERY frame the pointer
   * rests on the button: 60 chirps a second. Pass a stable id and this
   * fires once, when the pointer moves onto something new.
   */
  let _lastHover = null;
  function hoverCue(id) {
    if (id === _lastHover) return false;
    _lastHover = id;
    if (id !== null && id !== undefined) SFX.uiHover();
    return true;
  }

  // ── Procedural music (update172) ─────────────────────────

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const mod12 = (n) => ((n % 12) + 12) % 12;

  /* THE SONGS. Chords are semitones from `root`, the chord's own root
     FIRST (the bass plays it). `bpc` bars per chord, so four chords
     make an eight-bar loop and the melody a sixteen-bar phrase (A, A').
     Drum patterns and every mix row are indexed by TENSION 0/1/2. */
  const SONGS = {
    /* The map: A dorian, slow and wide — Am, G, D, Em. */
    explore: {
      bpm: 76, root: 57, scale: [0, 2, 3, 5, 7, 9, 10], bpc: 2, tension: 0,
      chords: [[0, 3, 7], [-2, 2, 5], [-7, -3, 0], [-5, -2, 2]],
      pad:   { voice: 'padSoft', oct: 0, cutoff: [900, 1300, 2000] },
      bass:  { voice: 'sub', pattern: [[0, 8, 0], [8, 6, 0], [14, 2, 7]], cutoff: [1500, 1500, 1800] },
      drums: { kick:  ['x.......x.......', 'x.......x.......', 'x.....x.x.......'],
               snare: ['................', '....x.......x...', '....x.......x...'],
               hat:   ['................', '..x...x...x...x.', 'x.x.x.x.x.x.x.x.'] },
      lead:  { voice: 'bell', oct: 12, span: 14, density: 0.6, rhythms: ['long', 'whole', 'walk'], cutoff: [6000, 6000, 7000] },
      arp:   { voice: 'arp', oct: 12, rate: 2, cutoff: [2500, 3000, 4000] },
      mix: [ { pad: 1,   bass: 0.55, drums: 0,    lead: 0.8, arp: 0 },
             { pad: 1,   bass: 0.8,  drums: 0.55, lead: 0.8, arp: 0.5 },
             { pad: 1,   bass: 1,    drums: 0.9,  lead: 0.9, arp: 0.9 } ],
    },
    /* A port: F lydian, warm and busy — F, G, C, Am, chords in stabs. */
    station: {
      bpm: 96, root: 53, scale: [0, 2, 4, 6, 7, 9, 11], bpc: 2, tension: 0,
      chords: [[0, 4, 7], [2, 6, 9], [-5, -1, 2], [4, 7, 11]],
      pad:   { voice: 'stab', oct: 0, stabs: [[0, 3], [6, 2], [10, 3]], cutoff: [2200, 2600, 3200] },
      bass:  { voice: 'sub', pattern: [[0, 3, 0], [4, 2, 7], [6, 2, 12], [8, 3, 0], [12, 2, 7], [14, 2, 12]], cutoff: [1600, 1600, 1900] },
      drums: { kick:  ['x.......x.......', 'x.......x.x.....', 'x...x...x...x...'],
               snare: ['....x.......x...', '....x.......x...', '....x.......x..x'],
               hat:   ['..x...x...x...x.', '..x...x...x...x.', 'x.xxx.xxx.xxx.xx'] },
      lead:  { voice: 'pluck', oct: 12, span: 14, density: 0.8, rhythms: ['walk', 'call', 'sync'], cutoff: [5000, 5000, 6000] },
      arp:   { voice: 'arp', oct: 24, rate: 2, cutoff: [3000, 3500, 4500] },
      mix: [ { pad: 0.8,  bass: 0.8, drums: 0.4, lead: 0.75, arp: 0.3 },
             { pad: 0.85, bass: 0.9, drums: 0.6, lead: 0.8,  arp: 0.5 },
             { pad: 0.9,  bass: 1,   drums: 0.8, lead: 0.85, arp: 0.7 } ],
    },
    /* A fight: E minor, driving — Em, C, D, B. */
    combat: {
      bpm: 126, root: 52, scale: [0, 2, 3, 5, 7, 8, 10], bpc: 2, tension: 1,
      chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]],
      pad:   { voice: 'pad', oct: 0, cutoff: [700, 1100, 1900] },
      bass:  { voice: 'pulse', pattern: [[0, 2, 0], [2, 2, 0], [4, 2, 12], [6, 2, 0], [8, 2, 0], [10, 2, 0], [12, 2, 12], [14, 2, 7]], cutoff: [700, 900, 1300] },
      drums: { kick:  ['x.......x.......', 'x..x....x..x....', 'x..x..x.x..x..x.'],
               snare: ['................', '....x.......x...', '....x.......x.xx'],
               hat:   ['..x...x...x...x.', '..x...x...x...x.', 'xxxxxxxxxxxxxxxx'] },
      lead:  { voice: 'saw', oct: 12, span: 15, density: 0.75, rhythms: ['drive', 'call', 'sync'], cutoff: [1800, 2400, 3200] },
      arp:   { voice: 'arp', oct: 12, rate: 1, cutoff: [1500, 2200, 3500] },
      mix: [ { pad: 0.9, bass: 0.5, drums: 0.25, lead: 0,   arp: 0 },
             { pad: 0.8, bass: 1,   drums: 0.85, lead: 0.6, arp: 0.2 },
             { pad: 0.9, bass: 1,   drums: 1,    lead: 0.8, arp: 0.85 } ],
    },
    /* The boss: C phrygian, heavy and galloping — Cm, Db, Bbm, G. */
    boss: {
      bpm: 108, root: 48, scale: [0, 1, 3, 5, 7, 8, 10], bpc: 2, tension: 1,
      chords: [[0, 3, 7], [1, 5, 8], [-2, 1, 5], [-5, -1, 2]],
      pad:   { voice: 'pad', oct: 0, cutoff: [600, 900, 1500] },
      bass:  { voice: 'pulse', pattern: [[0, 1, 0], [1, 1, 0], [2, 2, 0], [4, 1, 0], [5, 1, 0], [6, 2, 12], [8, 1, 0], [9, 1, 0], [10, 2, 0], [12, 1, 0], [13, 1, 0], [14, 2, 7]], cutoff: [600, 800, 1100] },
      drums: { kick:  ['x.....x.x.......', 'x..x..x.x..x..x.', 'x.xx..x.x.xx..x.'],
               snare: ['........x.......', '....x.......x...', '....x.......x.xx'],
               hat:   ['x...x...x...x...', 'x.x.x.x.x.x.x.x.', 'xxxxxxxxxxxxxxxx'],
               tom:   ['................', '..............x.', '..........x.x.xx'] },
      lead:  { voice: 'brass', oct: 12, span: 12, density: 0.7, rhythms: ['long', 'drive', 'whole'], cutoff: [1400, 1900, 2600] },
      arp:   { voice: 'arpSaw', oct: 12, rate: 1, cutoff: [1200, 1800, 2800] },
      mix: [ { pad: 1,   bass: 0.7, drums: 0.4, lead: 0.5,  arp: 0 },
             { pad: 0.9, bass: 1,   drums: 0.9, lead: 0.7,  arp: 0.3 },
             { pad: 1,   bass: 1,   drums: 1,   lead: 0.85, arp: 0.9 } ],
    },
  };
  const LAYERS = ['pad', 'bass', 'drums', 'lead', 'arp'];
  const DRUM_HITS = ['kick', 'snare', 'hat', 'tom'];

  /* Rhythms of one bar of melody: [step, length] in sixteenths. */
  const RHYTHMS = {
    long:  [[0, 6], [6, 2], [8, 8]],
    whole: [[0, 16]],
    walk:  [[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]],
    call:  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
    sync:  [[2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
    drive: [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
  };

  /* REAL TRACKS, ONE DAY. Name an OGG per mode here (or call
     Audio.setTrack) and that mode plays the file, looped, through the
     same crossfades — the synth stays as the fallback. */
  const MUSIC_FILES = {
    // combat: 'music/combat.ogg',
  };

  function _songDef(mode) { return SONGS[mode] || SONGS.explore; }

  /* A small deterministic generator: the same song is the same song
     every time it is played, and the tests can read it. */
  function _rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function _hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function chordOf(mode, bar) {
    const d = _songDef(mode);
    const loop = d.chords.length * d.bpc;
    return d.chords[Math.floor(mod12Bar(bar, loop) / d.bpc)];
  }
  function mod12Bar(bar, loop) { return ((bar % loop) + loop) % loop; }

  /** Pitch classes a melody note may sit on over this chord: every
   *  chord tone, and the scale tones NOT a semitone from one of them —
   *  a passing D over a B-major chord's D♯ is the clash this keeps out. */
  function _pools(d, chord, lo, hi) {
    const cpc = chord.map(mod12);
    const clash = (pc) => cpc.some(c => { const x = Math.abs(c - pc); return Math.min(x, 12 - x) === 1; });
    const chordT = [], weakT = [];
    for (let m = lo; m <= hi; m++) {
      const pc = mod12(m - d.root);
      if (cpc.includes(pc)) { chordT.push(m); weakT.push(m); }
      else if (d.scale.includes(pc) && !clash(pc)) weakT.push(m);
    }
    return { chordT, weakT };
  }

  function _nearest(pool, target, prev, rng) {
    const sorted = pool.slice().sort((a, b) => (Math.abs(a - target) - Math.abs(b - target)) || (a - b));
    if (sorted.length > 1 && sorted[0] === prev && rng() < 0.6) return sorted[1];
    return sorted[0];
  }

  /* THE MELODY (update172): sixteen bars, A then A'. Strong beats sit
     on chord tones, the rest step through the scale, every phrase ends
     home on a chord tone. Some bars of a sparse song are left to breathe. */
  const _phraseCache = {};
  function _genBars(mode, rng, bars, from, to, prev) {
    const d = _songDef(mode), L = d.lead;
    const lo = d.root + L.oct, hi = lo + L.span;
    for (let b = from; b < to; b++) {
      const chord = chordOf(mode, b);
      if (b > 0 && rng() > L.density) { bars[b] = []; continue; }
      const rh = RHYTHMS[L.rhythms[Math.floor(rng() * L.rhythms.length)]] || RHYTHMS.long;
      const { chordT, weakT } = _pools(d, chord, lo, hi);
      const notes = [];
      rh.forEach(([step, len], i) => {
        const strong = step === 0 || step === 8 || len >= 6 || i === rh.length - 1;
        const pool = strong ? chordT : weakT;
        const move = [-4, -2, -1, 1, 2, 3][Math.floor(rng() * 6)];
        const target = Math.max(lo, Math.min(hi, prev + move));
        const midi = _nearest(pool, target, prev, rng);
        notes.push({ step, len, midi });
        prev = midi;
      });
      bars[b] = notes;
    }
    return prev;
  }
  function _phrase(mode) {
    if (_phraseCache[mode]) return _phraseCache[mode];
    const d = _songDef(mode), L = d.lead;
    const lo = d.root + L.oct, hi = lo + L.span;
    const bars = new Array(16);
    const rngA = _rng(_hashStr(mode) ^ 0x9e3779b9);
    const start = _pools(d, chordOf(mode, 0), lo, hi).chordT;
    let prev = start[Math.floor(start.length / 2)] ?? lo;
    prev = _genBars(mode, rngA, bars, 0, 8, prev);
    // A': the first six bars again, a new ending
    for (let b = 8; b < 14; b++) bars[b] = bars[b - 8].map(n => ({ ...n }));
    const rngB = _rng(_hashStr(mode) ^ 0x7f4a7c15);
    const last6 = bars[13].length ? bars[13][bars[13].length - 1].midi : prev;
    _genBars(mode, rngB, bars, 14, 16, last6);
    // both halves land home: the last note of bars 7 and 15 on a chord tone near the root
    [7, 15].forEach(b => {
      if (!bars[b].length) bars[b] = [{ step: 0, len: 16, midi: lo }];
      const home = _pools(d, chordOf(mode, b), lo, hi).chordT;
      const n = bars[b][bars[b].length - 1];
      n.midi = home.slice().sort((a, c) => Math.abs(a - lo) - Math.abs(c - lo))[0] ?? n.midi;
    });
    return (_phraseCache[mode] = bars);
  }

  /**
   * ONE BAR OF A SONG, as data (update172): what each layer plays at
   * which sixteenth. Pure — same mode, bar and tension, same bar — so
   * the scheduler and the tests read the same music.
   */
  const _barCache = {};
  function composeBar(mode, bar, tension = 1) {
    const d = _songDef(mode);
    const t = Math.max(0, Math.min(2, tension | 0));
    const loop = d.chords.length * d.bpc;
    const b16 = ((bar % 16) + 16) % 16;
    const key = `${SONGS[mode] ? mode : 'explore'}|${((bar % 48) + 48) % 48}|${t}`;
    if (_barCache[key]) return _barCache[key];
    const chord = chordOf(mode, bar);
    const ev = [];

    // pad: a held chord where the chord starts, or the song's stabs
    if (d.pad.stabs) {
      d.pad.stabs.forEach(([step, len]) => chord.forEach(c =>
        ev.push({ layer: 'pad', step, len, midi: d.root + d.pad.oct + c, vel: 1 })));
    } else if (mod12Bar(bar, loop) % d.bpc === 0) {
      chord.forEach(c => ev.push({ layer: 'pad', step: 0, len: 16 * d.bpc, midi: d.root + d.pad.oct + c, vel: 1 }));
    }
    // bass: the chord's root, its octave and fifth, two octaves down
    d.bass.pattern.forEach(([step, len, iv]) => {
      let m = d.root - 12 + chord[0] + iv;
      while (m > d.root - 5) m -= 12;
      while (m < d.root - 26) m += 12;
      ev.push({ layer: 'bass', step, len, midi: m, vel: step % 4 === 0 ? 1 : 0.8 });
    });
    // drums: the row for this tension
    DRUM_HITS.forEach(hit => {
      const row = d.drums[hit]?.[t];
      if (!row) return;
      for (let s = 0; s < 16; s++) if (row[s] === 'x') {
        ev.push({ layer: 'drums', step: s, len: 1, hit, vel: s % 4 === 0 ? 1 : 0.75 });
      }
    });
    // lead: this bar of the sixteen-bar phrase
    (_phrase(mode)[b16] || []).forEach(n => ev.push({ layer: 'lead', step: n.step, len: n.len, midi: n.midi, vel: 1 }));
    // arp: the chord walked up and back, every `rate` sixteenths
    const tones = chord.concat(chord.map(c => c + 12));
    const walk = tones.concat(tones.slice(1, -1).reverse());
    for (let s = 0, i = 0; s < 16; s += d.arp.rate, i++) {
      ev.push({ layer: 'arp', step: s, len: d.arp.rate, midi: d.root + d.arp.oct + walk[i % walk.length], vel: s % 4 === 0 ? 1 : 0.7 });
    }
    return (_barCache[key] = ev);
  }

  /** Every playable voice, one place. `dest` is a layer's (or a stinger's) input. */
  function _note(dest, voice, midi, t, dur, vel = 1) {
    const f = mtof(midi);
    switch (voice) {
      case 'padSoft': {
        const d = dur + 0.8;
        _tone({ freq: f, type: 'triangle', duration: d, gain: 0.06 * vel, attack: 0.45, release: 0.8, detune: 6, destination: dest, when: t });
        _tone({ freq: f, type: 'sine', duration: d, gain: 0.05 * vel, attack: 0.6, release: 0.8, detune: -6, destination: dest, when: t });
        break;
      }
      case 'pad': {
        const d = dur + 0.5;
        _tone({ freq: f, type: 'sawtooth', duration: d, gain: 0.04 * vel, attack: 0.3, release: 0.6, detune: 8, destination: dest, when: t });
        _tone({ freq: f, type: 'sawtooth', duration: d, gain: 0.04 * vel, attack: 0.3, release: 0.6, detune: -8, destination: dest, when: t });
        break;
      }
      case 'stab':
        _tone({ freq: f, type: 'triangle', duration: Math.max(0.12, dur), gain: 0.07 * vel, attack: 0.004, decay: 0.12, sustain: 0.35, release: 0.08, destination: dest, when: t });
        _tone({ freq: f, type: 'sawtooth', duration: 0.1, gain: 0.025 * vel, attack: 0.003, release: 0.06, destination: dest, when: t });
        break;
      case 'sub':
        _tone({ freq: f, type: 'sine', duration: dur, gain: 0.28 * vel, attack: 0.01, release: 0.08, destination: dest, when: t });
        _tone({ freq: f * 2, type: 'triangle', duration: dur, gain: 0.04 * vel, attack: 0.01, release: 0.06, destination: dest, when: t });
        break;
      case 'pulse':
        _tone({ freq: f, type: 'sawtooth', duration: dur * 0.9, gain: 0.13 * vel, attack: 0.004, release: 0.05, destination: dest, when: t });
        _tone({ freq: f, type: 'sine', duration: dur * 0.9, gain: 0.2 * vel, attack: 0.004, release: 0.05, destination: dest, when: t });
        break;
      case 'bell':
        _tone({ freq: f, type: 'sine', duration: Math.max(0.5, dur), gain: 0.09 * vel, attack: 0.004, decay: 0.3, sustain: 0.35, release: 0.45, destination: dest, when: t });
        _tone({ freq: f * 2.005, type: 'sine', duration: 0.6, gain: 0.025 * vel, attack: 0.003, decay: 0.15, sustain: 0.2, release: 0.3, destination: dest, when: t });
        break;
      case 'pluck':
        _tone({ freq: f, type: 'triangle', duration: Math.max(0.15, dur), gain: 0.09 * vel, attack: 0.003, decay: 0.15, sustain: 0.3, release: 0.1, destination: dest, when: t });
        _tone({ freq: f * 2, type: 'square', duration: 0.08, gain: 0.012 * vel, attack: 0.002, release: 0.05, destination: dest, when: t });
        break;
      case 'saw':
        _tone({ freq: f, type: 'sawtooth', duration: dur, gain: 0.06 * vel, attack: 0.012, release: 0.08, detune: 5, destination: dest, when: t });
        _tone({ freq: f, type: 'sawtooth', duration: dur, gain: 0.04 * vel, attack: 0.012, release: 0.08, detune: -5, destination: dest, when: t });
        break;
      case 'brass':
        _tone({ freq: f, type: 'sawtooth', duration: dur, gain: 0.07 * vel, attack: 0.06, release: 0.12, destination: dest, when: t });
        _tone({ freq: f / 2, type: 'square', duration: dur, gain: 0.025 * vel, attack: 0.08, release: 0.12, destination: dest, when: t });
        break;
      case 'arpSaw':
        _tone({ freq: f, type: 'sawtooth', duration: Math.min(dur, 0.16), gain: 0.045 * vel, attack: 0.003, release: 0.07, destination: dest, when: t });
        break;
      default:   // 'arp'
        _tone({ freq: f, type: 'triangle', duration: Math.min(dur, 0.2), gain: 0.065 * vel, attack: 0.004, release: 0.08, destination: dest, when: t });
    }
  }

  function _drum(dest, hit, t, vel = 1) {
    switch (hit) {
      case 'kick':
        _tone({ freq: 150, freqEnd: 45, type: 'sine', duration: 0.3, gain: 0.5 * vel, attack: 0.002, release: 0.24, destination: dest, when: t });
        break;
      case 'snare':
        _noise({ duration: 0.18, gain: 0.26 * vel, filter: 'bandpass', freq: 1800, Q: 0.9, release: 0.15, destination: dest, when: t });
        _tone({ freq: 210, freqEnd: 160, type: 'triangle', duration: 0.1, gain: 0.12 * vel, release: 0.08, destination: dest, when: t });
        break;
      case 'tom':
        _tone({ freq: 180, freqEnd: 85, type: 'sine', duration: 0.35, gain: 0.38 * vel, attack: 0.003, release: 0.3, destination: dest, when: t });
        break;
      case 'crash':
        _noise({ duration: 1.3, gain: 0.11 * vel, hpFreq: 5000, attack: 0.003, release: 1.1, destination: dest, when: t });
        break;
      default:   // 'hat'
        _noise({ duration: 0.04, gain: 0.08 * vel, hpFreq: 8000, release: 0.035, destination: dest, when: t });
    }
  }

  // ── The band: songs, layers, crossfades ──────────────────

  const XFADE     = 1.6;    // seconds a mode change takes
  const LOOKAHEAD = 0.35;   // seconds queued ahead on the audio clock
  const MAX_LIVE  = 2;      // the song playing and the one fading out

  let _songs        = [];     // live songs, the last one is the current
  let _musicTimer   = null;
  let _musicMode    = null;
  let _musicRunning = false;
  let _tension      = 0;
  const _files      = {};     // mode → { url, buffer, loading, failed }

  function _current() {
    for (let i = _songs.length - 1; i >= 0; i--) if (!_songs[i].fading && !_songs[i].dead) return _songs[i];
    return null;
  }

  function _killSong(s) {
    if (!s || s.cut) return;
    s.cut = true;
    s.dead = true;
    try { s.file?.stop?.(); } catch (e) { /* already stopped */ }
    try { s.bus.disconnect(); } catch (e) { /* gone */ }
    _songs = _songs.filter(x => x !== s);
  }

  function _mixFor(d, t) { return d.mix[Math.max(0, Math.min(2, t))]; }
  function _cutFor(spec, t) {
    const c = spec?.cutoff;
    return Array.isArray(c) ? c[Math.max(0, Math.min(2, t))] : (c ?? 12000);
  }

  function _startSong(mode, fadeIn) {
    const now = ctx.currentTime;
    // whatever was playing fades out under the new one
    _songs.forEach(s => {
      if (s.fading || s.dead) return;
      s.fading = true;
      s.bus.gain.cancelScheduledValues?.(now);
      s.bus.gain.setValueAtTime?.(s.bus.gain.value, now);
      s.bus.gain.linearRampToValueAtTime(0, now + XFADE);
      s.endAt = now + XFADE + 0.05;
    });
    while (_songs.length >= MAX_LIVE) _killSong(_songs[0]);

    const d = _songDef(mode);
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + Math.max(0.05, fadeIn));
    bus.connect(duckGain);
    const s = { mode, def: d, bus, layers: {}, target: {}, step: 0,
                nextTime: now + 0.06, fading: false, dead: false, endAt: Infinity, file: null };

    const file = _files[mode];
    if (file?.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = file.buffer; src.loop = true;
      src.connect(bus); src.start(now + 0.02);
      s.file = src;
    } else {
      const mix = _mixFor(d, _tension);
      LAYERS.forEach(name => {
        const flt = ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = _cutFor(d[name], _tension);
        const g = ctx.createGain();
        g.gain.value = mix[name] ?? 0;
        flt.connect(g); g.connect(bus);
        s.layers[name] = { in: flt, gain: g, filter: flt };
        s.target[name] = mix[name] ?? 0;
      });
    }
    _songs.push(s);
    return s;
  }

  function playMusic(mode = 'explore') {
    if (!_enabled || !ctx) return;
    if (_musicMode === mode && _musicRunning) return;
    const wasRunning = _musicRunning && !!_current();
    _musicMode    = mode;
    _musicRunning = true;
    _tension      = _songDef(mode).tension;   // a new song starts at its own level
    /* THE MUSIC SLIDER WAS DEAD (update42). This line used to read
       `musicGain.gain.value = 0.35` — a literal. Every mode change
       (menu → map → combat → boss, a dozen call sites) threw the
       player's level away and snapped music back to 35%, while the
       options screen kept drawing the value they had chosen. The
       slider looked like it worked and never did. */
    _restoreMusicGain();
    _startSong(mode, wasRunning ? XFADE : 0.6);
    if (!_musicTimer) _scheduleBeat();
  }

  /** Put musicGain back where the player set it, killing any pending fade. */
  function _restoreMusicGain() {
    if (!musicGain || !ctx) return;
    // A pending linearRampToValueAtTime(0) beats a plain `.value =` write,
    // so the ramp has to be cancelled or the slider is inert during a fade.
    musicGain.gain.cancelScheduledValues?.(ctx.currentTime);
    musicGain.gain.value = _vol.music;
  }

  function stopMusic(fade = 1.0) {
    _musicRunning = false;
    _musicMode = null;
    if (_musicTimer) { clearTimeout(_musicTimer); _musicTimer = null; }
    // the songs stop being written now and are cut once the fade is over
    const doomed = _songs.slice();
    doomed.forEach(s => { s.fading = true; s.dead = true; });
    _songs = [];
    if (musicGain) {
      const now = ctx.currentTime;
      musicGain.gain.cancelScheduledValues?.(now);
      musicGain.gain.setValueAtTime?.(musicGain.gain.value, now);
      musicGain.gain.linearRampToValueAtTime(0, now + fade);
      setTimeout(() => { doomed.forEach(_killSong); _restoreMusicGain(); },
                 (fade + 0.1) * 1000);
    }
  }

  function _scheduleBeat() {
    _musicTimer = null;
    if (!_musicRunning || !ctx) return;
    const now = ctx.currentTime;
    _songs.slice().forEach(s => {
      if (s.dead) return;
      if (s.endAt <= now) { _killSong(s); return; }
      if (s.file) return;
      const stepDur = 60 / s.def.bpm / 4;
      if (s.nextTime < now) s.nextTime = now + 0.05;
      // Queue every sixteenth inside the lookahead at its EXACT audio-clock
      // time — a busy render frame can no longer delay or double a beat.
      let _guard = 0;   // FREEZE GUARD: hard bound on queued steps
      while (s.nextTime < now + LOOKAHEAD && s.nextTime < s.endAt && _guard++ < 32) {
        _playStep(s, s.step, s.nextTime, stepDur);
        s.step++;
        s.nextTime += stepDur;
      }
    });
    _musicTimer = setTimeout(_scheduleBeat, 100);
  }

  function _playStep(s, step, t, stepDur) {
    const bar = Math.floor(step / 16), pos = step % 16;
    const tension = s.fading ? s.def.tension : _tension;
    const mix = _mixFor(s.def, tension);
    composeBar(s.mode, bar, tension).forEach(e => {
      if (e.step !== pos) return;
      if (!(mix[e.layer] > 0)) return;   // a silent layer costs nothing
      const dest = s.layers[e.layer]?.in;
      if (!dest) return;
      if (e.layer === 'drums') _drum(dest, e.hit, t, e.vel);
      else _note(dest, s.def[e.layer].voice, e.midi, t, e.len * stepDur, e.vel);
    });
  }

  /**
   * TENSION (update172): 0 calm, 1 engaged, 2 "źle" — the hull low, a
   * fire, a breach, boarders. Each song says what each layer does at
   * each level; the change rides in over about a second.
   * Returns true when the level actually changed.
   */
  function setTension(level) {
    const t = Math.max(0, Math.min(2, Math.round(Number(level) || 0)));
    if (t === _tension) return false;
    _tension = t;
    const s = _current();
    if (s && !s.file && ctx) {
      const now = ctx.currentTime, mix = _mixFor(s.def, t);
      LAYERS.forEach(name => {
        const L = s.layers[name];
        if (!L) return;
        s.target[name] = mix[name] ?? 0;
        L.gain.gain.setTargetAtTime(s.target[name], now, 0.35);
        L.filter.frequency.setTargetAtTime(_cutFor(s.def[name], t), now, 0.35);
      });
    }
    return true;
  }
  function getTension() { return _tension; }

  /** What the band is doing, for the tests and for anyone debugging. */
  function musicState() {
    const s = _current();
    return {
      mode: _musicMode, running: _musicRunning, tension: _tension,
      live: _songs.filter(x => !x.dead).length,
      layers: s ? { ...s.target } : {},
      bpm: s ? s.def.bpm : null,
      file: !!s?.file,
    };
  }

  // ── Real tracks (the OGG door) ───────────────────────────

  function setTrack(mode, url) {
    if (!url) { delete _files[mode]; return true; }
    _files[mode] = { url, buffer: null, loading: false, failed: false };
    _loadTrack(mode);
    return true;
  }
  function trackFor(mode) { return _files[mode]?.url ?? null; }
  function _loadTrack(mode) {
    const f = _files[mode];
    if (!f || f.buffer || f.loading || !ctx || typeof fetch !== 'function' || !ctx.decodeAudioData) return;
    f.loading = true;
    fetch(f.url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => {
      f.buffer = buf; f.loading = false;
      // the file arrived while its mode is playing: swap it in
      if (_musicRunning && _musicMode === mode) _startSong(mode, XFADE);
    }).catch(() => { f.loading = false; f.failed = true; });
  }

  // ── Stingers (update172) ─────────────────────────────────

  /* Short phrases for the moments that matter. Each has its own bus
     ('music' follows the music slider, 'sfx' the effects one), a length
     the song is ducked for, and a cooldown so one moment is said once. */
  const STINGERS = {
    victory: { len: 2.4, cooldown: 5, play(d, t) {
      [60, 64, 67].forEach((m, i) => _note(d, 'pluck', m + 12, t + i * 0.11, 0.2, 1));
      [72, 76, 79, 84].forEach(m => _note(d, 'brass', m - 12, t + 0.36, 1.6, 0.9));
      [60, 67].forEach(m => _note(d, 'padSoft', m, t + 0.36, 1.4, 1));
      _note(d, 'bell', 84, t + 0.36, 1.2, 0.8);
      _drum(d, 'kick', t + 0.36, 1); _drum(d, 'crash', t + 0.36, 1);
    } },
    defeat: { len: 3.4, cooldown: 20, play(d, t) {
      [48, 51, 55].forEach(m => _note(d, 'padSoft', m, t, 2.8, 1.1));
      [67, 63, 60, 59].forEach((m, i) => _note(d, 'bell', m, t + i * 0.55, 0.7, 0.9));
      _drum(d, 'tom', t, 0.8); _drum(d, 'tom', t + 1.65, 0.6);
    } },
    jump: { len: 1.8, cooldown: 3, play(d, t) {
      [62, 66, 69, 73, 74, 78, 81, 85].forEach((m, i) => _note(d, 'bell', m, t + i * 0.05, 0.3, 0.55));
      [74, 81].forEach(m => _note(d, 'padSoft', m, t + 0.45, 1.0, 0.8));
    } },
    dock: { len: 1.8, cooldown: 4, play(d, t) {
      [77, 81, 84, 88].forEach((m, i) => _note(d, 'bell', m, t + i * 0.15, 0.6, 0.75));
      [53, 57, 60, 64].forEach(m => _note(d, 'padSoft', m, t, 1.4, 0.8));
    } },
    job: { len: 1.0, cooldown: 1.5, play(d, t) {
      [76, 80, 83].forEach((m, i) => _note(d, 'bell', m, t + i * 0.08, 0.25, 0.8));
      _note(d, 'bell', 88, t + 0.24, 0.6, 0.9);
    } },
    contract: { len: 3.8, cooldown: 20, play(d, t) {
      for (let i = 0; i < 8; i++) _drum(d, 'snare', t + i * 0.06, 0.35 + i * 0.06);
      [67, 72, 76, 79].forEach((m, i) => _note(d, 'brass', m - 12, t + 0.5 + i * 0.16, 0.18, 1));
      [60, 64, 67, 72].forEach(m => _note(d, 'brass', m, t + 1.15, 2.2, 0.9));
      [48, 55, 60].forEach(m => _note(d, 'padSoft', m, t + 1.15, 2.2, 1));
      [84, 88, 91, 96].forEach((m, i) => _note(d, 'bell', m, t + 1.15 + i * 0.12, 0.8, 0.6));
      _drum(d, 'kick', t + 1.15, 1); _drum(d, 'crash', t + 1.15, 1.2);
    } },
    boarding: { len: 1.9, cooldown: 6, bus: 'sfx', play(d, t) {
      for (let i = 0; i < 4; i++) {
        _tone({ freq: i % 2 ? 520 : 660, type: 'square', duration: 0.32, gain: 0.07, attack: 0.01, release: 0.06, destination: d, when: t + i * 0.42 });
        _tone({ freq: i % 2 ? 260 : 330, type: 'sawtooth', duration: 0.32, gain: 0.05, attack: 0.01, release: 0.06, destination: d, when: t + i * 0.42 });
      }
    } },
    tractor: { len: 2.4, cooldown: 8, play(d, t) {
      [36, 42].forEach(m => _note(d, 'pad', m, t, 2.0, 1.4));
      _tone({ freq: 320, freqEnd: 70, type: 'sine', duration: 1.8, gain: 0.18, attack: 0.05, release: 0.6, destination: d, when: t });
      _noise({ duration: 1.8, gain: 0.08, filter: 'lowpass', freq: 3000, freqEnd: 200, attack: 0.1, release: 0.8, destination: d, when: t });
      _drum(d, 'tom', t, 1);
    } },
  };
  const _stingerAt  = {};
  const _stingerLog = [];
  const _wall = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) / 1000;

  /** Play one stinger by name. False when unknown, hushed, or said too recently. */
  function stinger(name) {
    const st = STINGERS[name];
    if (!st || _hush > 0) return false;
    const now = _wall();
    if (now - (_stingerAt[name] ?? -1e9) < st.cooldown) return false;
    _stingerAt[name] = now;
    _stingerLog.push(name);
    if (_stingerLog.length > 20) _stingerLog.shift();
    if (!_enabled || !ctx) return true;
    const t0 = ctx.currentTime + 0.02;
    _duck(st.len);
    st.play(st.bus === 'sfx' ? sfxGain : stingerGain, t0);
    return true;
  }
  function stingers() { return Object.keys(STINGERS); }
  function stingerLog() { return _stingerLog.slice(); }

  /** The song steps back while a stinger speaks, then comes back up. */
  function _duck(len, depth = 0.35) {
    if (!duckGain || !ctx) return;
    const now = ctx.currentTime, g = duckGain.gain;
    g.cancelScheduledValues?.(now);
    g.setValueAtTime?.(g.value, now);
    g.linearRampToValueAtTime(depth, now + 0.1);
    g.setValueAtTime?.(depth, now + len);
    g.linearRampToValueAtTime(1, now + len + 0.9);
  }

  // ── Ambience: fire and air (update172) ───────────────────

  /* While our ship burns or leaks there is a bed under everything: a low
     roar and crackle per fire, a hiss per open breach. Set from the
     fight every frame; only a CHANGE does anything. */
  let _amb = { fire: 0, breach: 0 };
  let _ambNodes = null;
  let _ambTimer = null;

  function _ambBuild() {
    if (_ambNodes || !ctx) return _ambNodes;
    const mk = (type, freq, Q) => {
      const src = ctx.createBufferSource();
      src.buffer = _noiseBuffer(); src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (f.Q) f.Q.value = Q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(sfxGain);
      src.start();
      return { src, f, g };
    };
    _ambNodes = { fire: mk('bandpass', 700, 0.6), breach: mk('highpass', 2800, 0.7) };
    return _ambNodes;
  }

  function setAmbience({ fire = 0, breach = 0 } = {}) {
    fire = Math.max(0, fire | 0); breach = Math.max(0, breach | 0);
    if (fire === _amb.fire && breach === _amb.breach) return false;
    _amb = { fire, breach };
    if (!_enabled || !ctx) return true;
    if (!_ambNodes && !fire && !breach) return true;
    const n = _ambBuild();
    const now = ctx.currentTime;
    n.fire.g.gain.setTargetAtTime(fire ? Math.min(0.12, 0.05 + 0.025 * fire) : 0, now, 0.4);
    n.breach.g.gain.setTargetAtTime(breach ? Math.min(0.1, 0.04 + 0.02 * breach) : 0, now, 0.4);
    if (fire && !_ambTimer) _crackle();
    return true;
  }
  function ambience() { return { ..._amb }; }

  /** The pops in a fire, a few a second, only while something burns. */
  function _crackle() {
    _ambTimer = null;
    if (!_amb.fire || !ctx) return;
    const n = Math.min(3, _amb.fire);
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.55) {
        _noise({ duration: 0.03 + Math.random() * 0.04, gain: 0.05 + Math.random() * 0.05,
                 filter: 'bandpass', freq: 1500 + Math.random() * 2500, Q: 2, release: 0.02,
                 when: ctx.currentTime + Math.random() * 0.15 });
      }
    }
    _ambTimer = setTimeout(_crackle, 160);
  }

  // ── Volume controls ───────────────────────────────────────

  /* The gain nodes are the truth, but they do not exist before init()
     and a headless test has no Web Audio at all — so mirror the three
     levels here. The options screen reads these. */
  let _vol = { master: 0.8, sfx: 1.0, music: 0.35 };

  /* A stinger is music, so the music slider sets it — a little above
     the song, so a victory is heard over the band it interrupts. */
  function _stingerLevel() { return Math.min(1, _vol.music * 1.5); }

  /* MUTE IS A SWITCH, NOT AN ERASER (update42). The old MUTE button
     wrote masterVolume = 0 straight into the save, so the level the
     player had picked was destroyed, the zero survived F5 — the game
     booted silent every time — and UNMUTE guessed 0.8 back. Mute is
     now its own flag: the slider keeps its value underneath. */
  let _muted = false;

  function _applyMaster() {
    if (masterGain) masterGain.gain.value = _muted ? 0 : _vol.master;
  }

  function setMasterVolume(v) {
    _vol.master = Utils.clamp(v, 0, 1);
    _applyMaster();
  }
  function setSfxVolume(v) {
    _vol.sfx = Utils.clamp(v, 0, 1);
    if (sfxGain) sfxGain.gain.value = _vol.sfx;
  }
  function setMusicVolume(v) {
    _vol.music = Utils.clamp(v, 0, 1);
    _restoreMusicGain();
    if (stingerGain) stingerGain.gain.value = _stingerLevel();
  }
  function setMuted(on) {
    _muted = !!on;
    _applyMaster();
  }
  function isMuted() { return _muted; }
  function getVolumes() { return { ..._vol, muted: _muted }; }

  /** What the gain nodes ACTUALLY hold. The mirror above can lie —
   *  it did for the whole life of the music slider, which is why this
   *  exists and why the tests assert on it and not on getVolumes(). */
  function getNodeLevels() {
    return {
      master:  masterGain  ? masterGain.gain.value  : null,
      sfx:     sfxGain     ? sfxGain.gain.value     : null,
      music:   musicGain   ? musicGain.gain.value   : null,
      stinger: stingerGain ? stingerGain.gain.value : null,
    };
  }

  /**
   * Pull the saved levels out of the save and apply them.
   * Called once at boot — until update40 the whole settings block in
   * save.js was written, persisted and never read by anything.
   */
  function applySettings() {
    const g = (k, d) => {
      const v = (typeof Save !== 'undefined' && Save.getSetting) ? Save.getSetting(k) : undefined;
      return (typeof v === 'number') ? v : d;
    };
    setMasterVolume(g('masterVolume', 0.8));
    setSfxVolume(g('sfxVolume', 1.0));
    setMusicVolume(g('musicVolume', 0.35));
    setMuted(Save?.getSetting?.('muted') === true);
  }

  // ── Public API ───────────────────────────────────────────

  return {
    init,
    resume,
    sfx: SFX,
    playMusic,
    stopMusic,
    setTension, getTension, musicState, composeBar, chordOf,
    songs: () => Object.keys(SONGS), songDef: (m) => SONGS[m] || null,
    setTrack, trackFor,
    stinger, stingers, stingerLog,
    setAmbience, ambience,
    fireVoice, impactVoice,
    setMasterVolume,
    setSfxVolume,
    setMusicVolume,
    setMuted,
    isMuted,
    getVolumes,
    getNodeLevels,
    applySettings,
    hoverCue, hush, hushed,
  };

})();
