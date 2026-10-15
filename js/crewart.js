/* ============================================================
   MOON WARS — crewart.js  (update124)
   The crew, drawn: every man in his suit, with his own face.

   jj, 13.10 (szkic v2 accepted): "troszkę większe postacie", "na
   plecach małe zbiorniki z powietrzem", "różne twarze … kolor włosów,
   oczy, usta, nos", glasses and eye colours, the portrait in the fight
   too — and "przy konsoli jest obrócony plecami do nas, a przodem kiedy
   je, leczy się".

   THREE VIEWS of one man, 20 x 28 pixels, feet on the bottom row:
     side   walking, fighting, mending (faces right; the caller mirrors)
     back   at a console — his back to us, both bottles showing
     front  standing about, eating, in the medbay — his face showing
   A flat pack with TWO bottles, caps in the suit's colour, a hose up
   into the helmet. A portrait, 48 x 48, for every card.

   ONE FACE PER MAN, FOR GOOD. `faceSeed` is rolled when he is made and
   saved with him (crew.js serialise), so he is the same man in the
   barracks, at the console and on the card. A record from before this
   update has no seed: one is taken from his name and corporation, which
   are saved, and it is written back the next time he is saved.

   Frames are painted at runtime (each man's face is his own) into
   24 x 32 canvases and cached per man and per state. The old
   `Animation.crewByColor` frames stay as the fallback for a page that
   has not loaded this file.
   ============================================================ */

'use strict';

const CrewArt = (() => {
  /** A frame and where the man stands in it: (ax, ay) is his centre at
   *  the height crew.js gives as `y` — the feet are HULL_GRID.FEET (5)
   *  below that, on the frame's row 30. */
  const FRAME = { w: 24, h: 32, ax: 12, ay: 25, ox: 2, oy: 2 };
  /** How much higher the stack over his head (health, name, marks)
   *  rides than over the old 18 px sprite. His head is 10 px higher; 7
   *  puts the health boxes right over the glass, as low as they go —
   *  the man at a console has the module's display over him. */
  const LIFT = 7;

  // ── colours ───────────────────────────────────────────────
  function rgbOf(c) {
    if (Array.isArray(c)) return c;
    const s = String(c || '').trim();
    let m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16));
    m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [+m[1], +m[2], +m[3]];
    return [77, 184, 255];
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const css = (c, a = 1) => a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const px = (g, x, y, w, h, c, a = 1) => { g.fillStyle = typeof c === 'string' ? c : css(c, a); g.fillRect(x, y, w, h); };

  // ── the face ──────────────────────────────────────────────
  function hash(s, k = 0) {
    let h = (Math.imul(s | 0, 0x9e3779b1) + Math.imul(k + 1, 0x85ebca77)) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const pick = (arr, seed, k) => arr[Math.floor(hash(seed, k) * arr.length) % arr.length];
  function strHash(str) {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return h | 0;
  }

  const SKIN = ['#f2d0b4', '#e8b896', '#d29a72', '#b07850', '#8a5a3a', '#5e3c28'];
  const HAIR = ['#1c1a1a', '#3a2618', '#6a4224', '#b07a3a', '#e0c070', '#a8381e', '#8a8a8a', '#e8e8e8', '#3a6ad0', '#c04a9a'];
  /** jj: "różne kolory oczu". Violet is the rare one. */
  const EYES = {
    brown: '#6a4022', dark: '#2a1c14', hazel: '#8a6a2a', amber: '#c8901e', green: '#3a8a4a',
    blue: '#3a78c8', ice: '#8ac8f0', grey: '#7a8490', violet: '#8a5ac8',
  };
  const EYE_ROLL = ['brown', 'brown', 'brown', 'dark', 'dark', 'hazel', 'amber', 'green', 'green',
                    'blue', 'blue', 'blue', 'ice', 'grey', 'grey', 'violet'];
  /** jj: "okulary będą cool" — about one man in two wears a pair. */
  const GLASSES = ['none', 'none', 'none', 'none', 'round', 'square', 'shades', 'goggles'];
  const LENS = ['#2a3040', '#3a5a8a', '#8a3a3a', '#2a6a4a'];
  const HAIRDO = ['short', 'buzz', 'long', 'bun', 'mohawk', 'bald', 'tail', 'fringe'];
  const NOSE = ['small', 'long', 'wide', 'hook'];
  const MOUTH = ['flat', 'smile', 'frown', 'thin', 'open'];
  const BEARD = ['none', 'none', 'none', 'stubble', 'full', 'tache', 'goatee'];

  /** A new man's seed: a fresh roll. */
  function newSeed() { return (Math.random() * 0x7fffffff) | 0; }
  /** His seed: the saved one, or — for a record from before update124 —
   *  one made from what was saved about him. */
  function seedOf(rec) {
    if (Number.isFinite(rec?.faceSeed)) return rec.faceSeed | 0;
    return strHash(`${rec?.name ?? '?'}|${rec?.race ?? ''}`);
  }
  /** What a man with this seed looks like — the same every time. */
  function faceOf(seed, race = null) {
    const eye = pick(EYE_ROLL, seed, 3);
    return {
      skin: pick(SKIN, seed, 1), hair: pick(HAIR, seed, 2),
      eye, eyes: EYES[eye],
      eyes2: hash(seed, 12) < 0.06 ? EYES[pick(EYE_ROLL, seed, 13)] : null,  // now and then, each eye its own
      glasses: pick(GLASSES, seed, 14), lens: pick(LENS, seed, 15),
      hairdo: pick(HAIRDO, seed, 4), nose: pick(NOSE, seed, 5), mouth: pick(MOUTH, seed, 6),
      beard: pick(BEARD, seed, 7), freckles: hash(seed, 8) < 0.2, scar: hash(seed, 9) < 0.15,
      narrow: hash(seed, 10) < 0.35, brow: hash(seed, 11) < 0.5 ? 'flat' : 'arch',
      cyborg: race === 'terra',
    };
  }

  // ── the suit ──────────────────────────────────────────────
  const TANK = [182, 192, 208], TANKD = [96, 106, 124], DARK = [16, 18, 26], HOSE = [104, 116, 134];
  const RING = [150, 170, 196], HAND = [210, 220, 232];
  function suit(colour) {
    const S = rgbOf(colour);
    return { S, SD: mix(S, [0, 0, 0], 0.4), SL: mix(S, [255, 255, 255], 0.35), G: mix(S, [255, 255, 255], 0.15) };
  }
  function glass(g, cx, cy) {
    g.save();
    g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(170,215,255,0.16)'; g.fill();
    g.strokeStyle = 'rgba(205,232,255,0.9)'; g.lineWidth = 1; g.stroke();
    g.restore();
    px(g, cx - 3, cy - 5, 2, 1, [255, 255, 255], 0.8);
  }
  function hairTop(g, hx, hy, f, w) {
    if (f.hairdo === 'bald') return;
    px(g, hx, hy, w, 2, rgbOf(f.hair));
    if (f.hairdo === 'mohawk') px(g, hx + Math.floor(w / 2) - 1, hy - 1, 2, 1, rgbOf(f.hair));
  }

  /* ── SIDE ─────────────────────────────────────────────── */
  function side(g, ox, oy, colour, f, pose = {}) {
    const { S, SD, SL, G } = suit(colour);
    const c = pose.crouch || 0, b = pose.bob || 0, y0 = oy + c + b;
    [[pose.legA ?? 0, SD], [pose.legB ?? 0, S]].forEach(([dx, col], i) => {
      const lx = ox + 8 + i * 3 + dx;
      px(g, lx, y0 + 20, 3, 6 - c, col);
      px(g, lx, oy + 26, 4, 2, DARK);
    });
    // the pack, flat against his back: one bottle in profile, its cap, the strap, the hose
    px(g, ox + 4, y0 + 12, 2, 8, TANK); px(g, ox + 6, y0 + 12, 1, 8, TANKD);
    px(g, ox + 4, y0 + 11, 2, 1, S);
    px(g, ox + 4, y0 + 15, 3, 1, DARK);
    px(g, ox + 5, y0 + 9, 1, 2, HOSE); px(g, ox + 6, y0 + 8, 2, 1, HOSE);
    px(g, ox + 7, y0 + 11, 7, 10, S); px(g, ox + 7, y0 + 11, 1, 10, SD);
    px(g, ox + 13, y0 + 12, 1, 8, SL); px(g, ox + 7, y0 + 17, 7, 1, SD);
    px(g, ox + 11, y0 + 13, 2, 2, [230, 240, 255]);
    const arm = pose.arm || 'down';
    if (arm === 'down')  { px(g, ox + 10, y0 + 12, 3, 7, G); px(g, ox + 10, y0 + 19, 3, 2, HAND); }
    if (arm === 'punch') { px(g, ox + 12, y0 + 12, 7, 3, G); px(g, ox + 19, y0 + 11, 1, 4, HAND); }
    if (arm === 'tool')  { px(g, ox + 11, y0 + 15, 5, 3, G); px(g, ox + 16, y0 + 15, 2, 3, HAND);
                           px(g, ox + 17, y0 + 12, 1, 8, [200, 200, 210]); px(g, ox + 16, y0 + 11, 3, 2, [200, 200, 210]); }
    const hx = ox + 9, hy = y0 + 2, sk = rgbOf(f.skin);
    px(g, hx, hy + 1, 6, 6, sk);
    px(g, hx + 4, hy + 3, 1, 1, f.cyborg ? [255, 60, 40] : rgbOf(f.eyes));
    px(g, hx + 5, hy + 4, 1, 1, mix(sk, [0, 0, 0], 0.25));
    if (f.glasses !== 'none') px(g, hx + 3, hy + 3, 3, 1, f.glasses === 'shades' ? rgbOf(f.lens) : [40, 44, 54]);
    hairTop(g, hx, hy, f, 5);
    if (f.hairdo !== 'bald') px(g, hx, hy + 2, 2, f.hairdo === 'long' || f.hairdo === 'tail' ? 5 : 2, rgbOf(f.hair));
    if (f.beard === 'full') px(g, hx + 2, hy + 5, 4, 2, rgbOf(f.hair));
    glass(g, hx + 3, hy + 4);
    px(g, hx - 1, hy + 9, 9, 1, RING);
  }

  /* ── BACK: at a console ───────────────────────────────── */
  function back(g, ox, oy, colour, f, pose = {}) {
    const { S, SD, G } = suit(colour);
    const b = pose.bob || 0, y0 = oy + b;
    px(g, ox + 6, y0 + 20, 3, 6, SD); px(g, ox + 11, y0 + 20, 3, 6, SD);
    px(g, ox + 6, oy + 26, 3, 2, DARK); px(g, ox + 11, oy + 26, 3, 2, DARK);
    px(g, ox + 5, y0 + 11, 10, 10, S); px(g, ox + 5, y0 + 17, 10, 1, SD);
    const up = pose.reach ? 1 : 0;            // his hands on the console, by turns
    px(g, ox + 3, y0 + 11 - up, 2, 6, G); px(g, ox + 15, y0 + 11 + up, 2, 6, G);
    // the two bottles, side by side, flat on his back
    px(g, ox + 6, y0 + 11, 3, 8, TANK); px(g, ox + 11, y0 + 11, 3, 8, TANK);
    px(g, ox + 8, y0 + 11, 1, 8, TANKD); px(g, ox + 13, y0 + 11, 1, 8, TANKD);
    px(g, ox + 6, y0 + 10, 3, 1, S); px(g, ox + 11, y0 + 10, 3, 1, S);
    px(g, ox + 5, y0 + 15, 10, 1, DARK);
    px(g, ox + 9, y0 + 9, 2, 2, HOSE);
    const hx = ox + 7, hy = y0 + 2, hr = rgbOf(f.hair);
    px(g, hx, hy + 1, 6, 6, rgbOf(f.skin));
    if (f.hairdo !== 'bald') {
      const long = f.hairdo === 'long' || f.hairdo === 'tail';
      px(g, hx, hy, 6, long ? 7 : 5, hr);
      if (f.hairdo === 'bun') px(g, hx + 2, hy - 1, 2, 2, hr);
      if (f.hairdo === 'tail') px(g, hx + 2, hy + 6, 2, 3, hr);
      if (f.hairdo === 'mohawk') { px(g, hx, hy, 6, 5, rgbOf(f.skin)); px(g, hx + 2, hy - 1, 2, 6, hr); }
      if (f.hairdo === 'buzz') px(g, hx, hy, 6, 4, mix(hr, rgbOf(f.skin), 0.4));
    }
    if (f.glasses === 'goggles') px(g, hx, hy + 3, 6, 1, [40, 44, 54]);
    glass(g, hx + 3, hy + 4);
    px(g, hx - 2, hy + 9, 10, 1, RING);
  }

  /* ── FRONT: idle, eating, in the medbay ───────────────── */
  function front(g, ox, oy, colour, f, pose = {}) {
    const { S, SD, SL, G } = suit(colour);
    const b = pose.bob || 0, y0 = oy + b;
    px(g, ox + 6, y0 + 20, 3, 6, SD); px(g, ox + 11, y0 + 20, 3, 6, S);
    px(g, ox + 6, oy + 26, 3, 2, DARK); px(g, ox + 11, oy + 26, 3, 2, DARK);
    // the bottle caps over his shoulders — the pack is behind him
    px(g, ox + 5, y0 + 10, 2, 2, TANK); px(g, ox + 13, y0 + 10, 2, 2, TANK);
    px(g, ox + 5, y0 + 9, 2, 1, S); px(g, ox + 13, y0 + 9, 2, 1, S);
    px(g, ox + 5, y0 + 11, 10, 10, S); px(g, ox + 5, y0 + 11, 1, 10, SD); px(g, ox + 14, y0 + 11, 1, 10, SL);
    px(g, ox + 5, y0 + 17, 10, 1, SD);
    px(g, ox + 7, y0 + 12, 1, 5, DARK); px(g, ox + 12, y0 + 12, 1, 5, DARK);
    px(g, ox + 9, y0 + 13, 2, 2, [230, 240, 255]);
    if (pose.eat === 2) {
      /* the tube DOWN at his chest, between bites (update128) */
      px(g, ox + 3, y0 + 12, 2, 8, G); px(g, ox + 3, y0 + 20, 2, 1, HAND);
      px(g, ox + 15, y0 + 12, 2, 5, G); px(g, ox + 12, y0 + 16, 3, 2, HAND);
      px(g, ox + 11, y0 + 13, 3, 4, [230, 200, 120]);
      px(g, ox + 11, y0 + 13, 3, 1, [255, 235, 170]);
    } else if (pose.eat) {
      px(g, ox + 3, y0 + 12, 2, 8, G); px(g, ox + 3, y0 + 20, 2, 1, HAND);
      px(g, ox + 15, y0 + 11, 2, 4, G); px(g, ox + 13, y0 + 9, 3, 2, HAND);
      px(g, ox + 12, y0 + 7, 3, 3, [230, 200, 120]);          // a ration tube at the visor port
      if (pose.chew) px(g, ox + 11, y0 + 6, 1, 1, [255, 235, 170]);
    } else if (pose.heal) {
      /* A DOSE (update128, jj: "animacja jedzenia i heal"): the medkit in
         his left hand, the injector pressed to his right arm — the press
         and the release are the two frames. */
      px(g, ox + 2, y0 + 15, 5, 4, [235, 240, 245]);           // the kit
      px(g, ox + 4, y0 + 16, 1, 2, [40, 200, 90]); px(g, ox + 3, y0 + 17, 3, 0 + 1, [40, 200, 90]);
      px(g, ox + 3, y0 + 12, 2, 3, G); px(g, ox + 2, y0 + 19, 2, 1, HAND);
      const pr = pose.heal === 2 ? 1 : 0;                       // pressed: the arm in a pixel
      px(g, ox + 15, y0 + 12, 2, 8, G);
      px(g, ox + 12 + pr, y0 + 13, 3, 2, HAND);                 // his left hand across, on the injector
      px(g, ox + 13 + pr, y0 + 12, 1, 3, [120, 255, 170]);      // the injector, green glass
      if (pose.heal === 2) px(g, ox + 16, y0 + 12, 1, 1, [180, 255, 200]);
    } else {
      px(g, ox + 3, y0 + 12, 2, 8, G); px(g, ox + 15, y0 + 12, 2, 8, G);
      px(g, ox + 3, y0 + 20, 2, 1, HAND); px(g, ox + 15, y0 + 20, 2, 1, HAND);
    }
    const hx = ox + 7, hy = y0 + 2, sk = rgbOf(f.skin), hr = rgbOf(f.hair);
    px(g, hx, hy + 1, 6, 6, sk);
    const e1 = f.cyborg ? [255, 60, 40] : rgbOf(f.eyes), e2 = rgbOf(f.eyes2 || f.eyes);
    px(g, hx + 1, hy + 3, 1, 1, e2); px(g, hx + 4, hy + 3, 1, 1, e1);
    if (f.glasses !== 'none') {
      const fr = f.glasses === 'shades' ? rgbOf(f.lens) : [40, 44, 54];
      if (f.glasses === 'shades') { px(g, hx + 1, hy + 3, 1, 1, fr); px(g, hx + 4, hy + 3, 1, 1, fr); }
      px(g, hx + 2, hy + 3, 2, 1, fr);
      if (f.glasses === 'goggles') px(g, hx, hy + 2, 6, 1, fr);
    }
    px(g, hx + 2, hy + 5, 2, 1, mix(sk, [120, 30, 40], 0.45));
    hairTop(g, hx, hy, f, 6);
    if (f.hairdo === 'long' || f.hairdo === 'tail') { px(g, hx, hy + 2, 1, 4, hr); px(g, hx + 5, hy + 2, 1, 4, hr); }
    if (f.hairdo === 'fringe') px(g, hx + 1, hy + 2, 4, 1, hr);
    if (f.beard === 'full') px(g, hx + 1, hy + 5, 4, 2, hr);
    if (f.beard === 'tache') px(g, hx + 1, hy + 5, 4, 1, hr);
    glass(g, hx + 3, hy + 4);
    px(g, hx - 2, hy + 9, 10, 1, RING);
  }

  /* ── ON THE DECK ──────────────────────────────────────── */
  function lying(g, ox, oy, colour, f) {
    const { S } = suit(colour);
    px(g, ox + 1, oy + 25, 7, 2, TANK);
    px(g, ox + 5, oy + 23, 10, 4, mix(S, [0, 0, 0], 0.3));
    px(g, ox + 15, oy + 24, 5, 2, mix(S, [0, 0, 0], 0.45));
    px(g, ox - 1, oy + 22, 4, 3, rgbOf(f.skin));
    g.save(); g.beginPath(); g.arc(ox + 1, oy + 23, 4, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(205,232,255,0.6)'; g.lineWidth = 1; g.stroke(); g.restore();
  }

  /* ── STATES → VIEWS ───────────────────────────────────── */
  /** Each state: its view, its poses (one per frame), frames a second,
   *  and whether it loops. jj's rule: at a console he turns his back to
   *  us; eating, idle and being healed he faces us; on the move, in a
   *  fight and mending a breach he is side on. */
  const STATES = {
    walk:    { view: 'side',  fps: 8, loop: true,  poses: [{ legA: -2, legB: 2 }, { bob: -1 }, { legA: 2, legB: -2 }, { bob: -1 }] },
    operate: { view: 'back',  fps: 3, loop: true,  poses: [{}, { reach: 1 }] },
    idle:    { view: 'front', fps: 2, loop: true,  poses: [{}, { bob: 1 }] },
    /* update128: the tube goes up to the visor, he chews, it comes down */
    eat:     { view: 'front', fps: 3, loop: true,  poses: [{ eat: 2 }, { eat: 1 }, { eat: 1, chew: 1, bob: 1 }, { eat: 1 }] },
    heal:    { view: 'front', fps: 3, loop: true,  poses: [{ heal: 1 }, { heal: 2 }, { heal: 2, bob: 1 }, { heal: 1 }] },
    repair:  { view: 'side',  fps: 4, loop: true,  poses: [{ arm: 'tool', crouch: 2 }, { arm: 'tool', crouch: 3 }] },
    fight:   { view: 'side',  fps: 6, loop: true,  poses: [{ legA: -1, legB: 2 }, { arm: 'punch', legA: -1, legB: 2 }] },
    die:     { view: 'lying', fps: 1, loop: false, poses: [{}] },
  };
  const VIEWS = { side, back, front, lying };

  /** Paint one pose into a context, at (ox, oy) = the top-left of his
   *  20 x 28 box. The suit colour and the face are his. */
  function paint(g, ox, oy, colour, face, state, i = 0) {
    const st = STATES[state] || STATES.idle;
    const pose = st.poses[i % st.poses.length];
    VIEWS[st.view](g, ox, oy, colour, face, pose);
  }

  function _canvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  const _frames = new Map();
  /** His frames for a state, painted once and kept. */
  function frames(seed, race, colour, state) {
    const key = `${seed}|${race ?? ''}|${colour}|${state}`;
    if (_frames.has(key)) return _frames.get(key);
    const st = STATES[state] || STATES.idle;
    const face = faceOf(seed, race);
    const out = st.poses.map((_, i) => {
      const c = _canvas(FRAME.w, FRAME.h);
      const g = c?.getContext?.('2d');
      if (g) { g.imageSmoothingEnabled = false; paint(g, FRAME.ox, FRAME.oy, colour, face, state, i); }
      return c;
    }).filter(Boolean);
    if (_frames.size > 600) _frames.clear();
    _frames.set(key, out);
    return out;
  }

  /** A playing animation for this man in this state — the same
   *  AnimationInstance the old frames used, at the frames' own size. */
  function anim(state, man) {
    const st = STATES[state] || STATES.idle;
    const fr = frames(seedOf(man), man?.race ?? null, man?.suitColor?.() ?? '#4db8ff', STATES[state] ? state : 'idle');
    const a = new Animation.AnimationInstance(fr, st.fps, st.loop);
    a.native = { w: FRAME.w, h: FRAME.h, ax: FRAME.ax, ay: FRAME.ay };
    a.crewState = STATES[state] ? state : 'idle';
    a.view = st.view;
    return a;
  }

  /* ── THE PORTRAIT ─────────────────────────────────────── */
  function portrait(g, ox, oy, colour, f, s = 48) {
    const k = s / 48;
    const P = (x, y, w, h, c, a) => px(g, ox + Math.round(x * k), oy + Math.round(y * k),
      Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), c, a);
    const S = rgbOf(colour);
    const sk = rgbOf(f.skin), skD = mix(sk, [0, 0, 0], 0.22), skL = mix(sk, [255, 255, 255], 0.18);
    const hr = rgbOf(f.hair), hrD = mix(hr, [0, 0, 0], 0.3);
    P(0, 0, 48, 48, [14, 22, 38]);
    P(6, 38, 36, 10, S); P(6, 38, 36, 2, mix(S, [255, 255, 255], 0.3));
    P(10, 40, 3, 8, [150, 160, 178]); P(35, 40, 3, 8, [150, 160, 178]);
    P(18, 36, 12, 4, RING);
    if (f.hairdo === 'long') P(12, 12, 24, 22, hrD);
    if (f.hairdo === 'tail') P(32, 18, 5, 14, hrD);
    if (f.hairdo === 'bun') P(19, 5, 10, 6, hr);
    P(14, 10, 20, 24, sk); P(14, 10, 2, 24, skD); P(32, 12, 2, 20, skL);
    P(12, 19, 2, 6, skD); P(34, 19, 2, 6, skD); P(17, 32, 14, 3, sk);
    if (f.hairdo === 'short')  { P(14, 8, 20, 5, hr); P(14, 12, 3, 5, hr); P(31, 12, 3, 4, hr); }
    if (f.hairdo === 'buzz')   { P(14, 9, 20, 3, hr, 0.75); }
    if (f.hairdo === 'long')   { P(13, 7, 22, 6, hr); P(12, 12, 3, 16, hr); P(33, 12, 3, 16, hr); }
    if (f.hairdo === 'bun')    { P(14, 8, 20, 5, hr); }
    if (f.hairdo === 'mohawk') { P(21, 3, 6, 9, hr); P(14, 10, 20, 2, hrD, 0.6); }
    if (f.hairdo === 'tail')   { P(14, 8, 20, 5, hr); P(31, 12, 3, 6, hr); }
    if (f.hairdo === 'fringe') { P(14, 8, 20, 5, hr); P(16, 12, 12, 3, hr); }
    const by = 17;
    if (f.brow === 'flat') { P(17, by, 5, 1, hrD); P(26, by, 5, 1, hrD); }
    else { P(17, by, 5, 1, hrD); P(18, by - 1, 3, 1, hrD); P(26, by, 5, 1, hrD); P(27, by - 1, 3, 1, hrD); }
    const eh = f.narrow ? 1 : 2, ey = 19;
    [[17, f.eyes2 || f.eyes], [26, f.eyes]].forEach(([ex, col]) => {
      P(ex, ey, 5, eh + 1, [240, 244, 250]);
      P(ex + 2, ey, 2, eh + 1, rgbOf(col));
      P(ex + 2, ey, 1, 1, [255, 255, 255]);
      /* A BLINK (update136): the lid comes down over the white, under
         whatever glasses he wears — behind shades nobody sees it. */
      if (f.blink) { P(ex, ey, 5, eh + 1, sk); P(ex, ey + eh, 5, 1, skD); }
    });
    const G = f.glasses, FR = [36, 40, 50];
    if (G === 'round')   { [[16, 18], [25, 18]].forEach(([x, y]) => { P(x, y - 1, 7, 1, FR); P(x, y + 4, 7, 1, FR); P(x - 1, y, 1, 4, FR); P(x + 7, y, 1, 4, FR); }); P(23, 19, 2, 1, FR); }
    if (G === 'square')  { [[16, 18], [25, 18]].forEach(([x, y]) => { P(x - 1, y - 1, 9, 1, FR); P(x - 1, y + 4, 9, 1, FR); P(x - 1, y, 1, 4, FR); P(x + 7, y, 1, 4, FR); }); P(23, 19, 2, 1, FR); }
    if (G === 'shades')  { P(15, 18, 8, 5, rgbOf(f.lens)); P(25, 18, 8, 5, rgbOf(f.lens)); P(23, 19, 2, 1, FR);
                           P(16, 18, 3, 1, [255, 255, 255], 0.35); P(26, 18, 3, 1, [255, 255, 255], 0.35); }
    if (G === 'goggles') { P(13, 19, 22, 3, FR); P(15, 17, 8, 6, [60, 66, 80]); P(25, 17, 8, 6, [60, 66, 80]);
                           P(16, 18, 6, 4, rgbOf(f.lens), 0.85); P(26, 18, 6, 4, rgbOf(f.lens), 0.85); }
    if (f.cyborg) {                                             // Terra: the implant over the right eye
      P(25, 17, 8, 6, [90, 98, 112]); P(26, 18, 6, 4, [40, 44, 54]);
      P(28, 19, 2, 2, [255, 70, 40]); P(32, 15, 2, 10, [120, 128, 142]);
    }
    if (f.nose === 'small') { P(23, 22, 2, 4, skD); }
    if (f.nose === 'long')  { P(23, 21, 2, 6, skD); P(22, 26, 4, 1, skD); }
    if (f.nose === 'wide')  { P(23, 22, 2, 4, skD); P(21, 25, 6, 2, skD); }
    if (f.nose === 'hook')  { P(23, 21, 2, 3, skD); P(24, 24, 2, 2, skD); P(22, 26, 3, 1, skD); }
    const mc = mix(sk, [120, 30, 40], 0.45);
    /* TALKING (update136, jj: "dana osoba niby rusza ustami"). `talk`
       'a' is a half-open mouth (a consonant), 'b' a wide one (a vowel);
       either replaces his resting mouth and is painted AFTER the beard,
       so a full beard still parts when he speaks. */
    const talking = f.talk === 'a' || f.talk === 'b';
    const m = talking ? null : f.mouth;
    if (m === 'flat')  P(20, 29, 8, 1, mc);
    if (m === 'smile') { P(20, 28, 1, 1, mc); P(21, 29, 6, 1, mc); P(27, 28, 1, 1, mc); }
    if (m === 'frown') { P(20, 30, 1, 1, mc); P(21, 29, 6, 1, mc); P(27, 30, 1, 1, mc); }
    if (m === 'thin')  P(21, 29, 6, 1, mix(sk, [0, 0, 0], 0.35));
    if (m === 'open')  { P(21, 28, 6, 3, [70, 24, 30]); P(22, 28, 4, 1, [235, 235, 235]); }
    if (f.beard === 'stubble') { P(16, 27, 16, 7, hr, 0.35); }
    if (f.beard === 'full')    { P(15, 26, 18, 9, hr); if (!talking) P(20, 29, 8, 1, mc); }
    if (f.beard === 'tache')   { P(19, 27, 10, 2, hr); }
    if (f.beard === 'goatee')  { P(21, 31, 6, 4, hr); P(20, 27, 8, 1, hr); }
    if (f.talk === 'a') { P(21, 28, 6, 2, [70, 24, 30]); P(22, 28, 4, 1, [220, 220, 220]); }
    if (f.talk === 'b') { P(20, 27, 8, 4, [62, 20, 26]); P(21, 27, 6, 1, [235, 235, 235]);
                          P(22, 30, 4, 1, [160, 70, 80]); }
    if (f.freckles) [[18, 24], [20, 25], [28, 24], [30, 25], [19, 26]].forEach(([x, y]) => P(x, y, 1, 1, skD));
    if (f.scar) [[16, 21], [17, 22], [18, 23], [19, 24]].forEach(([x, y]) => P(x, y, 1, 1, [180, 90, 90]));
    g.save();
    g.beginPath(); g.arc(ox + 24 * k, oy + 22 * k, 19 * k, 0, Math.PI * 2);
    g.fillStyle = 'rgba(170,215,255,0.08)'; g.fill();
    g.strokeStyle = 'rgba(205,232,255,0.85)'; g.lineWidth = Math.max(1, 1.5 * k); g.stroke();
    g.beginPath(); g.arc(ox + 24 * k, oy + 22 * k, 16 * k, Math.PI * 1.1, Math.PI * 1.45);
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = Math.max(1, 1.5 * k); g.stroke();
    g.restore();
    P(38, 30, 3, 10, HOSE); P(36, 30, 4, 2, HOSE);
  }

  const _portraits = new Map();
  /** His portrait, painted once at 48 and kept. */
  function portraitCanvas(rec) {
    const colour = (typeof crewColor === 'function') ? crewColor(rec) : '#4db8ff';
    const seed = seedOf(rec);
    const key = `${seed}|${rec?.race ?? ''}|${colour}`;
    if (_portraits.has(key)) return _portraits.get(key);
    const c = _canvas(48, 48);
    const g = c?.getContext?.('2d');
    if (g) { g.imageSmoothingEnabled = false; portrait(g, 0, 0, colour, faceOf(seed, rec?.race ?? null), 48); }
    if (_portraits.size > 200) _portraits.clear();
    _portraits.set(key, c);
    return c;
  }

  /** A man (live or a saved record) who gets a face: people, not cats. */
  function isPerson(rec) {
    if (!rec || rec.isPet) return false;
    if (typeof CORP_DEFS !== 'undefined' && CORP_DEFS[rec.race]?.pet) return false;
    return true;
  }

  return {
    FRAME, LIFT, STATES, EYES, GLASSES, HAIRDO, NOSE, MOUTH, BEARD, SKIN, HAIR,
    faceOf, seedOf, newSeed, strHash, paint, frames, anim, portrait, portraitCanvas, isPerson,
    _cacheSizes: () => ({ frames: _frames.size, portraits: _portraits.size }),
  };
})();

// Classic scripts keep top-level `const` off `window`; publish it so
// game.js can tell a stale index.html (no crewart.js) and load it.
if (typeof window !== 'undefined') window.CrewArt = CrewArt;
