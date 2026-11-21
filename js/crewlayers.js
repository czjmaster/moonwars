/* ============================================================
   MOON WARS — crewlayers.js  (update246)
   The crew from LAYERS, the RimWorld way (jj 20.11): one grey suit the game paints in the corporation's colour,
   a head built from parts (bald head, eyes with brows, hair, beard — skin and hair coloured by the game), a
   hologram shield for a helmet. Every man is still his own `faceSeed`: the same face in every view, every frame.

   THE PARTS (tools/crew_v2/export.py, from GPT sheets jj generated 20.11):
     art/crew2_head_tint.png / _fixed.png    every head, and every eye/hair/beard already fitted to every head,
                                             60x60 cells centred on the helmet's centre (3 px a game unit)
     art/crew2_<sheet>_tint / _fixed / _over the body frames, 72x96 (24x32 units): walk, side, front, back
     js/crew2data.js (CREW2)                 where each cell is, and per body frame where the helmet sits
   "_tint" is the grey LIGHTNESS of what the game recolours (suit fabric, skin, hair): the colour is multiplied into
   it. "_fixed" keeps its own colour (outlines, eyes, metal). "_over" marks a body frame's pixels that go in front of
   the head and the shield (a hand raised past the collar, the collar's front lip).

   THE FLOOR STAYS (as with every picture in this game): if the files are not there — the tests, a page that failed
   to load them — `ready()` is false and crewart.js draws the man as before. Pets are never drawn here.

   THE SHIELD (jj 20.11): not glass — a faint blue hologram bubble. It opens by folding back into the collar in two
   arcs, left and right at once, and closes by growing out of it the same way until the arcs meet on top ("ziuu"
   and a soft click: Audio.sfx.helmetOpen / helmetClose, on the frames that start the move). A man eats with it open.
   ============================================================ */

'use strict';

const CrewLayers = (() => {
  const D = (typeof CREW2 !== 'undefined') ? CREW2 : null;
  const K = D?.k ?? 3;
  /** The frame every layered man is drawn in: 40 x 34 game units (the 24 x 32 body cell with 8 units either side
   *  for a head that falls or leans, 2 above for the bubble). His feet sit where the old 24 x 32 frame had them. */
  const FRAME = { w: 40, h: 34, ax: 20, ay: 27 };
  const BODY_X = 8 * K, BODY_Y = 2 * K;          // the body cell inside the frame, in px
  const FW = FRAME.w * K, FH = FRAME.h * K;      // 120 x 102 px
  const IMAGES = D ? ['crew2_head_tint', 'crew2_head_fixed',
    ...Object.keys(D.bodies).flatMap(n => [`crew2_${n}_tint`, `crew2_${n}_fixed`, `crew2_${n}_over`])] : [];

  function img(name) {
    if (typeof Assets === 'undefined') return null;
    if (Assets.source?.(name) !== 'file') return null;
    return Assets.get(name);
  }
  let _ready = null;
  /** Every picture loaded from a file (never the generated stand-ins): only then is a man drawn from layers. */
  function ready() {
    if (_ready) return true;
    if (!D || typeof document === 'undefined') return false;
    const ok = IMAGES.every(n => { const i = img(n); return i && (i.width > 1); });
    if (ok) _ready = true;
    return ok;
  }

  // ── who he is ─────────────────────────────────────────────
  /* The parts are picked FROM HIS OLD FACE (crewart.js faceOf), so the man jj already knows keeps his hair, his
     beard and his colours: a long, bun, tail or fringe hairdo makes her a woman (women's eyes, no beard). */
  const HAIR_OF = { short: [0, 2], buzz: [6], long: [1], bun: [3], mohawk: [0], bald: [-1], tail: [7], fringe: [5] };
  const FEMALE_HAIR = new Set(['long', 'bun', 'tail', 'fringe']);
  const BEARD_OF = { none: -1, stubble: 0, full: 1, tache: 2, goatee: 3 };
  const EYES_F = [1, 3, 5, 7], EYES_M = [0, 2, 4, 6];
  const HEADS_F = [0, 1, 5, 7], HEADS_M = [0, 2, 3, 4, 6, 7];
  function h01(seed, k) {
    let h = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(k + 101, 0x85ebca77)) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const pickH = (arr, seed, k) => arr[Math.floor(h01(seed, k) * arr.length) % arr.length];
  /** His parts: head, eyes, hair, beard (indices into the sheets; -1 = none), and his skin and hair colours. */
  function traitsOf(seed, race = null) {
    const f = (typeof CrewArt !== 'undefined') ? CrewArt.faceOf(seed, race) : { hairdo: 'short', beard: 'none', skin: '#d29a72', hair: '#3a2618' };
    const female = FEMALE_HAIR.has(f.hairdo);
    let beard = female ? -1 : (BEARD_OF[f.beard] ?? -1);
    if (beard === 1 && h01(seed, 3) < 0.6) beard = pickH([1, 4, 5, 6, 7], seed, 4);   // the four new beards too
    return {
      female,
      head: pickH(female ? HEADS_F : HEADS_M, seed, 1),
      eyes: pickH(female ? EYES_F : EYES_M, seed, 2),
      hair: pickH(HAIR_OF[f.hairdo] ?? [0], seed, 5),
      beard, skin: f.skin, hairCol: f.hair,
    };
  }

  // ── painting ──────────────────────────────────────────────
  function canvas(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function cellXY(meta, i) { return [(i % meta.cols) * meta.cw, Math.floor(i / meta.cols) * meta.ch]; }
  /** One cell of a "_tint" atlas with a colour multiplied into it (alpha kept), cached. */
  const _tinted = new Map();
  function tinted(atlas, meta, i, colour) {
    const key = `${atlas}|${i}|${colour}`;
    let c = _tinted.get(key);
    if (c) return c;
    const src = img(atlas); if (!src) return null;
    const [sx, sy] = cellXY(meta, i);
    c = canvas(meta.cw, meta.ch); const g = c.getContext('2d');
    g.drawImage(src, sx, sy, meta.cw, meta.ch, 0, 0, meta.cw, meta.ch);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = colour; g.fillRect(0, 0, meta.cw, meta.ch);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(src, sx, sy, meta.cw, meta.ch, 0, 0, meta.cw, meta.ch);
    g.globalCompositeOperation = 'source-over';
    if (_tinted.size > 4000) _tinted.clear();
    _tinted.set(key, c);
    return c;
  }
  function blit(g, atlas, meta, i, x, y) {
    const src = img(atlas); if (!src) return;
    const [sx, sy] = cellXY(meta, i);
    g.drawImage(src, sx, sy, meta.cw, meta.ch, x, y, meta.cw, meta.ch);
  }
  /** His head in the helmet's square (60 x 60 px, the helmet's centre in the middle), for one view. */
  const _heads = new Map();
  function headCanvas(t, view) {
    const key = `${t.head}|${t.eyes}|${t.hair}|${t.beard}|${t.skin}|${t.hairCol}|${view}`;
    let c = _heads.get(key);
    if (c) return c;
    const H = D.heads, meta = H.atlas, ix = H.index;
    c = canvas(meta.cw, meta.ch); const g = c.getContext('2d');
    const part = (kind, k, col) => {
      const i = ix[kind][k]; if (i == null) return;
      const tc = tinted('crew2_head_tint', meta, i, col); if (tc) g.drawImage(tc, 0, 0);
      blit(g, 'crew2_head_fixed', meta, i, 0, 0);
    };
    part('head', `${view}.${t.head}`, t.skin);
    if (view < 2) part('eyes', `${view}.${t.head}.${t.eyes}`, t.hairCol);
    if (view < 2 && t.beard >= 0) part('beard', `${view}.${t.head}.${t.beard}`, t.hairCol);
    if (t.hair >= 0) part('hair', `${view}.${t.head}.${t.hair}`, t.hairCol);
    if (_heads.size > 400) _heads.clear();
    _heads.set(key, c);
    return c;
  }
  /** The body frame in his suit's colour (and, separately, only its "over" pixels). */
  const _bodies = new Map();
  function bodyCanvas(sheet, i, colour, overOnly) {
    const key = `${sheet}|${i}|${colour}|${overOnly ? 1 : 0}`;
    let c = _bodies.get(key);
    if (c) return c;
    const meta = D.bodies[sheet].atlas;
    c = canvas(meta.cw, meta.ch); const g = c.getContext('2d');
    const tc = tinted(`crew2_${sheet}_tint`, meta, i, colour); if (tc) g.drawImage(tc, 0, 0);
    blit(g, `crew2_${sheet}_fixed`, meta, i, 0, 0);
    if (overOnly) {
      g.globalCompositeOperation = 'destination-in';
      blit(g, `crew2_${sheet}_over`, meta, i, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
    if (_bodies.size > 2000) _bodies.clear();
    _bodies.set(key, c);
    return c;
  }

  /** THE SHIELD: a faint blue hologram bubble, `open` 0 = closed … 1 = folded away into the collar. The two arcs
   *  grow from the collar (the bubble's bottom) up both sides and meet on top. `t` drifts the scan lines. */
  function drawShield(g, cx, cy, R, open, t = 0) {
    const theta = Math.PI * (1 - Math.max(0, Math.min(1, open)));
    if (theta <= 0.02) return;
    const a0 = Math.PI / 2 - theta, a1 = Math.PI / 2 + theta;      // canvas angles, PI/2 = straight down
    g.save();
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath();
    g.fillStyle = 'rgba(150,215,255,0.16)'; g.fill();
    g.clip();
    g.fillStyle = 'rgba(150,215,255,0.10)';                           // scan lines, drifting
    const off = (t * 9) % 3;
    for (let y = cy - R + off; y < cy + R; y += 3) g.fillRect(cx - R, y, 2 * R, 1);
    g.restore();
    g.save();
    g.lineWidth = 1.4; g.strokeStyle = 'rgba(175,235,255,0.85)';
    g.beginPath(); g.arc(cx, cy, R - 0.7, a0, a1); g.stroke();
    if (theta > Math.PI * 0.72) {                                     // the glint, once the top has grown in
      g.lineWidth = 1.1; g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.arc(cx, cy, R * 0.72, Math.PI * 1.08, Math.PI * 1.38); g.stroke();
    }
    if (theta < Math.PI - 0.02) {                                     // the growing edges glow
      g.lineWidth = 2; g.strokeStyle = 'rgba(205,245,255,0.9)';
      for (const a of [a0, a1]) {
        g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55);
        g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
      }
    }
    g.restore();
  }

  /** One frame: body, head on the collar (tilted with it), the shield, then what goes in front of them. */
  function paintFrame(t, colour, sheet, i, open, bare, tick = 0) {
    const B = D.bodies[sheet], fr = B.frames[i];
    const c = canvas(FW, FH), g = c.getContext('2d');
    g.drawImage(bodyCanvas(sheet, i, colour, false), BODY_X, BODY_Y);
    const hx = BODY_X + fr.hx, hy = BODY_Y + fr.hy, rad = (fr.tilt || 0) * Math.PI / 180;
    g.save(); g.translate(hx, hy); if (rad) g.rotate(rad);
    const hc = headCanvas(t, B.view); g.drawImage(hc, -hc.width / 2, -hc.height / 2);
    if (!bare) drawShield(g, 0, 0, D.helmet_r, open, tick);
    g.restore();
    g.drawImage(bodyCanvas(sheet, i, colour, true), BODY_X, BODY_Y);
    return c;
  }

  // ── the states the game asks for ──────────────────────────
  /* Frame lists into the sheets (export.py order): walk 0-11; side: idle 0-3, shoot 4-7, punch 8-11, repair 12-15,
     hit 16-17, fall 18, lying 19; front: idle 0-3, eat 4-7, heal 8-11, salute 12-15, arms crossed 16-19;
     back: idle 0-3, work 4-15. */
  const R = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  const OPEN_STEPS = [0.15, 0.35, 0.55, 0.75, 0.92, 1];
  const SEQ = {
    walk:    { sheet: 'walk',  frames: R(0, 11), fps: 14 },
    operate: { sheet: 'back',  frames: R(4, 15), fps: 6 },
    idle:    { sheet: 'front', frames: [0, 1, 2, 3, 2, 1], fps: 3 },
    heal:    { sheet: 'front', frames: R(8, 11), fps: 4 },
    salute:  { sheet: 'front', frames: [12, 13, 14, 14, 14, 14, 15], fps: 3 },
    repair:  { sheet: 'side',  frames: R(12, 15), fps: 5 },
    fight:   { sheet: 'side',  frames: R(8, 11), fps: 6 },
    shoot:   { sheet: 'side',  frames: R(4, 7), fps: 5 },
    die:     { sheet: 'side',  frames: [19], fps: 1, loop: false },
    /* EATING (jj 20.11): the shield folds away, he eats, it closes. 12 fps: the fold takes half a second. */
    eat:     { sheet: 'front', fps: 12, eat: true },
  };
  /** The frames of one state: [{ sheet, i, open }], and the cues (frame index → sound). */
  function plan(state, bare) {
    const s = SEQ[state] ?? SEQ.idle;
    if (!s.eat) return { list: s.frames.map(i => ({ sheet: s.sheet, i, open: bare ? 1 : 0 })), fps: s.fps, loop: s.loop !== false, cues: null };
    const chew = [];
    for (const i of [4, 5, 6, 5, 6, 5, 6, 5, 6, 7]) chew.push({ sheet: 'front', i, open: 1 }, { sheet: 'front', i, open: 1 });
    if (bare) return { list: chew, fps: 12, loop: true, cues: null };
    const list = [
      ...OPEN_STEPS.map(o => ({ sheet: 'front', i: 0, open: o })),
      ...chew,
      ...OPEN_STEPS.slice().reverse().map(o => ({ sheet: 'front', i: 0, open: o === 1 ? 0.92 : o - 0.15 })),
      { sheet: 'front', i: 0, open: 0 }, { sheet: 'front', i: 1, open: 0 }, { sheet: 'front', i: 2, open: 0 },
    ];
    /* ONCE OPEN, ONCE SHUT (update250, jj 21.11: „animacja jedzenia 2 razy się otwierała hełm, a powinien raz otworzyć,
       raz zamknąć, jak skończy jedzenie"): the whole fold–chew–fold looped while the meal lasted, so a long meal opened
       and shut the shield again and again. Now it opens once, the CHEWING loops (`hold`, AnimationInstance) for as long
       as he eats, and the man lets go of it when the meal is over — the shield closes and the animation ends. */
    return { list, fps: 12, loop: false, hold: [OPEN_STEPS.length, OPEN_STEPS.length + chew.length - 1],
             cues: { 0: 'helmetOpen', [OPEN_STEPS.length + chew.length]: 'helmetClose' } };
  }

  const _frames = new Map();
  let _count = 0;
  /** A man's frames for a state, painted once and kept. */
  function frames(seed, race, colour, state, bare = false) {
    if (!ready()) return null;
    const st = SEQ[state] ? state : 'idle';
    const key = `${seed}|${race ?? ''}|${colour}|${st}|${bare ? 1 : 0}`;
    let f = _frames.get(key);
    if (f) return f;
    const t = traitsOf(seed, race), p = plan(st, bare);
    const list = p.list.map((q, n) => paintFrame(t, colour, q.sheet, q.i, q.open, bare, n));
    _count += list.length;
    if (_count > 1800) { _frames.clear(); _count = list.length; }   // ~90 MB at most, then they repaint as needed
    f = { list, fps: p.fps, loop: p.loop, cues: p.cues, hold: p.hold ?? null };
    _frames.set(key, f);
    return f;
  }

  /** A playing animation for this man — what CrewArt.anim hands the crew when the layers are loaded. */
  function anim(state, man) {
    if (!ready() || typeof Animation === 'undefined') return null;
    if (typeof CrewArt !== 'undefined' && CrewArt.isPerson && !CrewArt.isPerson(man)) return null;
    const st = SEQ[state] ? state : 'idle';
    const seed = (typeof CrewArt !== 'undefined') ? CrewArt.seedOf(man) : 1;
    const f = frames(seed, man?.race ?? null, man?.suitColor?.() ?? '#4db8ff', st, !!man?.bare);
    if (!f) return null;
    const a = new Animation.AnimationInstance(f.list, f.fps, f.loop);
    a.native = { w: FRAME.w, h: FRAME.h, ax: FRAME.ax, ay: FRAME.ay, smooth: true };
    a.crewState = st;
    a.view = ({ walk: 'side', side: 'side', front: 'front', back: 'back' })[SEQ[st].sheet] ?? 'front';
    if (st === 'die') a.view = 'lying';
    a.cues = f.cues;
    if (f.hold) { a.hold = f.hold; a.holding = true; }       // the chewing loops until he lets go (update250)
    a.layered = true;
    return a;
  }

  /* ── HIS PORTRAIT (update250) ── his head and shoulders from the layers, facing us, the shield up (down when
     `bare` — an inmate, a man off duty), on the dark of a crew card; `size` px square, kept. */
  const _portraits = new Map();
  const PORTRAIT_CROP = 46;          // px of the frame round his head and shoulders (the frame is 120 × 102)
  function portrait(seed, race, colour, bare = false, size = 96) {
    if (!ready()) return null;
    const key = `${seed}|${race ?? ''}|${colour}|${bare ? 1 : 0}|${size}`;
    if (_portraits.has(key)) return _portraits.get(key);
    const t = traitsOf(seed, race), B = D.bodies.front, fr = B.frames[0];
    const f = paintFrame(t, colour, 'front', 0, bare ? 1 : 0, bare, 0);
    const c = canvas(size, size), g = c.getContext('2d');
    if (!bare) { g.fillStyle = 'rgb(14,22,38)'; g.fillRect(0, 0, size, size); }
    const cx = BODY_X + fr.hx, cy = BODY_Y + fr.hy + 3, h = PORTRAIT_CROP;
    g.imageSmoothingEnabled = true;
    g.drawImage(f, cx - h / 2, cy - h / 2, h, h, 0, 0, size, size);
    if (_portraits.size > 300) _portraits.clear();
    _portraits.set(key, c);
    return c;
  }

  return { FRAME, SEQ, IMAGES, ready, traitsOf, plan, frames, anim, drawShield, portrait, _reset: () => { _ready = null; } };
})();
