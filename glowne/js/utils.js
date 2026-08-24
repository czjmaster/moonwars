/* ============================================================
   MOON WARS — utils.js
   Shared math, geometry, and helper utilities.
   No dependencies. Must be loaded first.
   ============================================================ */

'use strict';

const Utils = (() => {

  // ── Math helpers ─────────────────────────────────────────

  /** Linear interpolation */
  function lerp(a, b, t) { return a + (b - a) * t; }

  /** Clamp value between min and max */
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /** Map value from one range to another */
  function map(v, inMin, inMax, outMin, outMax) {
    return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
  }

  /** Random integer in [min, max) — EXCLUSIVE at the top. */
  function randInt(min, max) { return Math.floor(Math.random() * (max - min)) + min; }

  /**
   * Random integer in [min, max] — INCLUSIVE.
   *
   * `randInt` is exclusive at the top and that has bitten this codebase
   * over and over: `randInt(1, 2)` is ALWAYS 1, so "they spare 1-2 He2"
   * spared exactly one, every time, and `derelictSpiderCount`'s ±1
   * variance never happened. Wherever the DATA declares an inclusive
   * range — `crewDamage: [10, 25]`, `scrap: [5, 15]`, a comment saying
   * "1-3" — use THIS one and the numbers mean what they say.
   */
  function randIn(min, max) { return randInt(min, max + 1); }

  /** Random float in [min, max) */
  function randFloat(min, max) { return Math.random() * (max - min) + min; }

  /** Random element from array */
  function pick(arr) { return arr[randInt(0, arr.length)]; }

  /** Shuffle array in place (Fisher-Yates) */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(0, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Euclidean distance */
  function dist(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  /** Angle from point a to point b (radians) */
  function angle(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }

  /** Wrap angle to [-π, π] */
  function wrapAngle(a) {
    if (!isFinite(a)) return 0;   // FREEZE GUARD: Infinity spins forever
    while (a >  Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ── Rect helpers ─────────────────────────────────────────

  /** AABB point-in-rect test */
  function pointInRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
  }

  /** AABB overlap test */
  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // ── String / display helpers ──────────────────────────────

  /** Zero-pad number to given width */
  function pad(n, width = 2) { return String(n).padStart(width, '0'); }

  /** Currency: Corporation Credits (CC), fuel: He2.
   *  The SAVE format still calls these fields `scrap` and `fuel` — that
   *  is deliberate (old saves keep loading); only the labels changed. */
  const CURRENCY   = 'CC';
  const FUEL_LABEL = 'He2';
  function scrapStr(n) { return `${n} ${CURRENCY}`; }
  function fuelStr(n)  { return `${n} ${FUEL_LABEL}`; }

  /** Capitalise first letter */
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ── DOM helpers ──────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function setLoadingProgress(pct, text) {
    const bar  = el('loading-bar');
    const txt  = el('loading-text');
    if (bar) bar.style.width = clamp(pct, 0, 100) + '%';
    if (txt && text) txt.textContent = text;
  }

  function hideLoadingScreen() {
    const screen = el('loading-screen');
    if (!screen) return;
    screen.classList.add('fade-out');
    setTimeout(() => { screen.style.display = 'none'; }, 700);
  }

  // ── Color helpers ────────────────────────────────────────

  /** Hex string → {r,g,b} */
  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /** rgba() string */
  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ── Deep clone ───────────────────────────────────────────

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // ── Unique ID ────────────────────────────────────────────

  let _uid = 0;
  function uid() { return ++_uid; }

  // ── Timer / once ─────────────────────────────────────────

  /**
   * Simple countdown timer.
   * tick(dt) returns true on expiry (once).
   */
  class Timer {
    constructor(duration) {
      this.duration = duration;
      this.elapsed  = 0;
      this.done     = false;
    }
    reset(dur) {
      if (dur !== undefined) this.duration = dur;
      this.elapsed = 0;
      this.done    = false;
    }
    tick(dt) {
      if (this.done) return false;
      this.elapsed += dt;
      if (this.elapsed >= this.duration) {
        this.done = true;
        return true;
      }
      return false;
    }
    get progress() { return clamp(this.elapsed / this.duration, 0, 1); }
  }

  /**
   * Repeating interval timer.
   * tick(dt) returns true every `interval` seconds.
   */
  class Interval {
    constructor(interval) {
      this.interval = interval;
      this.acc      = 0;
    }
    tick(dt) {
      this.acc += dt;
      if (this.acc >= this.interval) {
        this.acc -= this.interval;
        return true;
      }
      return false;
    }
    reset() { this.acc = 0; }
  }

  // ── Public API ───────────────────────────────────────────

  return {
    lerp, clamp, map, randInt, randIn, randFloat, pick, shuffle,
    dist, angle, wrapAngle,
    pointInRect, rectsOverlap,
    pad, scrapStr, fuelStr, cap, CURRENCY, FUEL_LABEL,
    el, setLoadingProgress, hideLoadingScreen,
    hexToRgb, rgba,
    deepClone, uid,
    Timer, Interval,
  };

})();
