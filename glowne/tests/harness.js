'use strict';
/* Shared Node harness for MoonWars smoke/logic tests.
 * Loads every js/*.js file (dependency order) into one vm context with
 * stubbed DOM/Audio/localStorage, so classes like Ship/CrewMember/
 * Reactor/CombatManager can be exercised directly from Node. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---- Proxy canvas context: accepts ANY method/property, does nothing ----
/* THE STYLE PROPERTIES ARE VALUES, NOT METHODS.
   The proxy below turns anything non-function into a no-op function,
   which meant `ctx.fillStyle = '#f00'` wrote a string and reading it
   back handed out a function — so every draw test that tried to assert
   a COLOUR was quietly comparing two functions and passing whatever it
   was given. These read back as what was written. */
const CTX_STYLE_PROPS = new Set([
  'fillStyle', 'strokeStyle', 'font', 'textAlign', 'textBaseline',
  'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'globalCompositeOperation',
  'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'filter',
  'lineDashOffset', 'miterLimit', 'imageSmoothingEnabled', 'direction',
]);

function makeCtx() {
  const handler = {
    get(target, prop) {
      if (prop === 'canvas') return target._canvas;
      if (CTX_STYLE_PROPS.has(prop)) return target[prop];
      if (!(prop in target)) {
        target[prop] = (typeof target[prop] === 'function') ? target[prop] : undefined;
      }
      if (typeof target[prop] === 'function') return target[prop];
      // Any unknown method call → no-op function returning undefined
      return function () { return undefined; };
    },
    set(target, prop, value) { target[prop] = value; return true; },
  };
  const base = {
    _canvas: null,
    /* A REAL-ISH measurement (update40).
       This returned a flat 10 for every string, so anything that lays
       out text by measuring it — `_clip`, the name plates, the
       notification wrapper — was invisible to the whole suite: every
       string "fitted" no matter how long. The game's text is monospace
       at 9-13px, so character count × 6 is close enough to catch a
       label running out of its panel. */
    measureText: (t) => ({ width: String(t ?? '').length * 6 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
    fill: () => {}, stroke: () => {}, clip: () => {},
    moveTo: () => {}, lineTo: () => {}, arc: () => {}, arcTo: () => {},
    rect: () => {}, roundRect: () => {}, ellipse: () => {}, bezierCurveTo: () => {},
    quadraticCurveTo: () => {}, translate: () => {}, rotate: () => {}, scale: () => {},
    setTransform: () => {}, resetTransform: () => {}, transform: () => {},
    fillRect: () => {}, strokeRect: () => {}, clearRect: () => {},
    fillText: () => {}, strokeText: () => {}, drawImage: () => {},
    setLineDash: () => {}, createPattern: () => ({}),
  };
  return new Proxy(base, handler);
}

// Canvas elements must be REAL instances of the HTMLCanvasElement
// global so animation.js's `f instanceof HTMLCanvasElement` blit guard
// passes for generated sprite frames.
class CanvasElementStub {
  constructor() {
    this.tagName = 'CANVAS';
    this.width = 1280;
    this.height = 720;
    this.style = makeStyle();
    this._ctx = makeCtx();
  }
  getContext() { return this._ctx; }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  toDataURL() { return 'data:,'; }
}

/** Style objects must answer the CSSOM calls real code makes —
 *  setProperty() for CSS custom properties, in particular. */
function makeStyle() {
  const st = {};
  Object.defineProperties(st, {
    setProperty:      { value: (k, v) => { st[k] = v; }, enumerable: false },
    getPropertyValue: { value: (k) => st[k] ?? '', enumerable: false },
    removeProperty:   { value: (k) => { delete st[k]; }, enumerable: false },
  });
  return st;
}

function makeElement(tag) {
  if (tag === 'canvas') return new CanvasElementStub();
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: makeStyle(),
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [],
    attrs: {},
    _listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(c => c !== child); return child; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    removeEventListener() {},
    focus() {}, blur() {}, click() {},
    // ui.js drives the station panel with real DOM queries — the stub
    // has to answer them or a station visit throws mid-test.
    querySelector() { return makeElement('div'); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; this.children = []; },
    insertAdjacentHTML() {},
    remove() {},
  };
  return el;
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

function buildSandbox() {
  const sandbox = {};
  sandbox.console = console;
  sandbox.Math = Math;
  sandbox.JSON = JSON;
  sandbox.performance = performance;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;

  const fakeCanvas = makeElement('canvas');
  const elements = { 'game-canvas': fakeCanvas };

  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => makeElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: makeElement('body'),
    documentElement: makeElement('html'),
  };
  // ui-overlay / station-screen / station-content etc. resolved lazily
  ['ui-overlay', 'station-screen', 'station-content', 'station-close-btn',
   'loading-screen', 'notif-container'].forEach(id => { elements[id] = makeElement('div'); });

  // Every AudioParam accepts the full scheduling API — the real audio
  // scheduler calls ramps on gain AND frequency.
  const audioParam = (v = 0) => ({
    value: v,
    setValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    setValueCurveAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  const audioNode = (extra = {}) => Object.assign({
    connect() { return this; }, disconnect() { return this; },
    start() {}, stop() {},
  }, extra);

  const AudioContextStub = function () {
    return {
      createGain: () => audioNode({ gain: audioParam(1) }),
      createOscillator: () => audioNode({ frequency: audioParam(440), detune: audioParam(0), type: 'sine' }),
      createBufferSource: () => audioNode({ buffer: null, playbackRate: audioParam(1), loop: false }),
      createBuffer: (ch = 1, len = 1) => ({ getChannelData: () => new Float32Array(len), length: len }),
      createBiquadFilter: () => audioNode({ frequency: audioParam(350), Q: audioParam(1), gain: audioParam(0), type: 'lowpass' }),
      createDynamicsCompressor: () => audioNode({
        threshold: audioParam(-24), knee: audioParam(30), ratio: audioParam(12),
        attack: audioParam(0.003), release: audioParam(0.25),
      }),
      createStereoPanner: () => audioNode({ pan: audioParam(0) }),
      createWaveShaper: () => audioNode({ curve: null, oversample: 'none' }),
      destination: audioNode(),
      sampleRate: 44100,
      currentTime: 0,
      state: 'running',
      resume: () => Promise.resolve(),
      suspend: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
  };

  const windowStub = {
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    AudioContext: AudioContextStub,
    webkitAudioContext: AudioContextStub,
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    localStorage: makeLocalStorage(),
    location: { href: 'http://localhost/' },
  };

  sandbox.window = windowStub;
  sandbox.document = document;
  sandbox.localStorage = windowStub.localStorage;
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.requestAnimationFrame = windowStub.requestAnimationFrame;
  sandbox.cancelAnimationFrame = windowStub.cancelAnimationFrame;
  sandbox.AudioContext = AudioContextStub;
  // animation.js guards its blits with `f instanceof HTMLCanvasElement
  // || f instanceof ImageBitmap` — both globals must EXIST or the draw
  // throws ReferenceError. Sprite frames made by document.createElement
  // ('canvas') are instances of the stub class, so blits still run.
  sandbox.HTMLCanvasElement = CanvasElementStub;
  sandbox.ImageBitmap = class ImageBitmap {};
  sandbox.Image = class Image { constructor() { this.width = 0; this.height = 0; } };
  sandbox.OffscreenCanvas = class OffscreenCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return makeCtx(); }
  };

  vm.createContext(sandbox);
  return sandbox;
}

const LOAD_ORDER = [
  'utils', 'input', 'audio', 'assets', 'particles', 'animation', 'camera',
  'save', 'crew', 'captain', 'systems', 'weapons', 'oxygen', 'fire', 'breach',
  'elevator', 'chips', 'cargo', 'ship', 'combat', 'boss', 'map', 'station', 'base',
  'basescreen', 'lootscreen', 'wreck', 'renderer', 'ui', 'game',
];

// vm.runInContext top-level `const`/`let`/`class` bindings live in the
// context's lexical environment — visible to LATER runInContext calls,
// but NOT as own-properties of the sandbox object itself, so the Node
// host side (this test file) can't reach them directly. Hoist every
// top-level declaration onto globalThis so both sides can see it.
function hoistNames(src) {
  const names = new Set();
  const re = /^(?:const|let|class|function)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  if (!names.size) return src;
  const footer = '\n;(function(){ ' +
    [...names].map(n => `try { globalThis.${n} = ${n}; } catch(e) {}`).join(' ') +
    ' })();\n';
  return src + footer;
}

// Game is one big IIFE that only exports { init } — everything the
// boarding/derelict logic lives in is private. For TESTS ONLY we widen
// that export in-memory (the shipped file is never touched) so the
// suite can drive combat directly instead of faking a browser.
const GAME_EXPORT = 'return { init, hasCaptain: _hasCaptain };';
// `typeof` guards keep the harness loadable against an OLDER game.js
// that predates a helper — the baseline run then fails on the specific
// assertion instead of blowing up at load time.
const T_REF = (n) => `get ${n}() { return typeof ${n} !== 'undefined' ? ${n} : undefined; }`;
const GAME_TEST_EXPORT = `return { init, hasCaptain: _hasCaptain, __test: {
  ${['_makeParty', '_updateParty', '_drawParty', '_drawCombat', '_updateCombat',
     '_launchBoarders', '_recallBoarders', '_recoverBoarders', '_returnBoarder',
     '_resolveEvent', '_crewClickResolve', '_playerCrewAliveCount',
     '_recallRect', '_retreatRect', '_activateCloak',
     '_travelTo', '_onWin', '_startCombat', '_spawnEnemy',
     '_maybeSOS', '_openBase', '_updateBase', '_startContract',
     '_openHold', '_openWreckLoot', '_updateLoot', '_unpackCargo', '_holdBtnRect',
     '_openWeaponLocker', '_queueWeaponLocker', '_syncAmmo', '_addMissiles',
     '_openPackScreen', '_openCpuBoard', '_awardChip', '_bossJustBeaten',
     '_recoverBoarders',
     '_saveStations', '_returnToStations', '_updateStation', '_saveShip', '_continueRun',
     '_creditCrew',
     '_crewUnderCursor',
     '_updateDocking', '_beginDocking', '_startWreckBoarding', '_wreckCleared',
     '_tickInfections', '_clearWreckMode',
     '_ratChance', '_rollForRats', '_syncFuel', '_addFuel', '_burnFuel', '_fuelAboard',
     '_canRetreat', '_startEvac', '_tickEvac', '_completeEvac', '_podSeconds',
     '_podRect', '_drawEvac', '_updateOptions', '_drawOptions', '_optValue', '_optMuted',
     '_purgeIntruders', '_setAllDoors', '_hasCaptain', '_needCaptain',
     '_finishContract', '_dockAtBase', '_nextSector', '_onLose',
     '_draw', '_update', '_updateMap', '_loop'].map(T_REF).join(',\n  ')},
  get sectorMap() { return _sectorMap; },    set sectorMap(v) { _sectorMap = v; },
  get derelictOfferedSupported() { return typeof _derelictOffered !== 'undefined'; },
  get wreckMode() { return _wreckMode; },      set wreckMode(v) { _wreckMode = v; },
  get wreckLooted() { return _wreckLooted; },
  get STATE() { return STATE; },            set STATE(v) { STATE = v; },
  get captain() { return typeof _captain !== 'undefined' ? _captain : undefined; },
  set captain(v) { try { _captain = v; } catch (e) {} },
  get playerShip() { return _playerShip; },  set playerShip(v) { _playerShip = v; },
  get enemyShip() { return _enemyShip; },    set enemyShip(v) { _enemyShip = v; },
  get boardingParty() { return _boardingParty; }, set boardingParty(v) { _boardingParty = v; },
  get enemyParty() { return _enemyParty; },  set enemyParty(v) { _enemyParty = v; },
  get event() { return _event; },            set event(v) { _event = v; },
  get derelictOffered() { return typeof _derelictOffered !== 'undefined' ? _derelictOffered : undefined; },
  set derelictOffered(v) { try { _derelictOffered = v; } catch (e) {} },
} };`;

function exposeGameInternals(src) {
  if (!src.includes(GAME_EXPORT)) {
    throw new Error('harness: game.js export signature changed — update GAME_EXPORT');
  }
  return src.replace(GAME_EXPORT, GAME_TEST_EXPORT);
}

function loadEngine({ stopBefore } = {}) {
  const sandbox = buildSandbox();
  for (const name of LOAD_ORDER) {
    if (stopBefore && name === stopBefore) break;
    const file = path.join(ROOT, 'js', name + '.js');
    let src = fs.readFileSync(file, 'utf8');
    if (name === 'game') src = exposeGameInternals(src);
    vm.runInContext(hoistNames(src), sandbox, { filename: file });
  }
  return sandbox;
}

module.exports = { loadEngine, buildSandbox, LOAD_ORDER, makeCtx };
