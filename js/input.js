/* ============================================================
   MOON WARS — input.js
   Centralised keyboard + mouse input manager.
   Provides a clean snapshot API so game logic never
   touches raw DOM events.
   ============================================================ */

'use strict';

const Input = (() => {

  // ── State ────────────────────────────────────────────────

  const keys     = new Set();   // currently held keys
  const pressed  = new Set();   // keys pressed this frame
  const released = new Set();   // keys released this frame

  const mouse = {
    x: 0, y: 0,          // canvas-space position
    rawX: 0, rawY: 0,    // screen-space position
    leftDown: false,
    rightDown: false,
    leftPressed: false,
    leftReleased: false,
    scrollDelta: 0,
  };

  // Click listeners registered by canvas UI elements
  // Each entry: { rect: {x,y,w,h}, cb: fn, once: bool }
  const clickListeners = [];

  let canvas = null;
  let scaleX = 1;
  let scaleY = 1;

  // ── Init ─────────────────────────────────────────────────

  function init(canvasEl) {
    canvas = canvasEl;

    window.addEventListener('keydown', onKeyDown, { passive: true });
    window.addEventListener('keyup',   onKeyUp,   { passive: true });

    canvas.addEventListener('mousemove',  onMouseMove,  { passive: true });
    canvas.addEventListener('mousedown',  onMouseDown,  { passive: true });
    canvas.addEventListener('mouseup',    onMouseUp,    { passive: true });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', onWheel, { passive: true });

    // Touch support (basic)
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: true });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });
  }

  /** Called by Renderer whenever canvas size changes */
  function setScale(sx, sy) { scaleX = sx; scaleY = sy; }

  // ── Per-frame flush ───────────────────────────────────────

  /** Must be called at the START of each game tick */
  function beginFrame() {
    pressed.clear();
    released.clear();
    mouse.leftPressed  = false;
    mouse.leftReleased = false;
    mouse.scrollDelta  = 0;
  }

  // ── Keyboard ─────────────────────────────────────────────

  function onKeyDown(e) {
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
    released.add(e.code);
  }

  function isHeld(code)     { return keys.has(code); }
  function isPressed(code)  { return pressed.has(code); }
  function isReleased(code) { return released.has(code); }

  // ── Mouse ────────────────────────────────────────────────

  function toCanvas(clientX, clientY) {
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scaleX,
      y: (clientY - rect.top)  / scaleY,
    };
  }

  function onMouseMove(e) {
    mouse.rawX = e.clientX;
    mouse.rawY = e.clientY;
    const p    = toCanvas(e.clientX, e.clientY);
    mouse.x    = p.x;
    mouse.y    = p.y;
  }

  function onMouseDown(e) {
    if (e.button === 0) {
      mouse.leftDown    = true;
      mouse.leftPressed = true;
    }
    if (e.button === 2) mouse.rightDown = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) {
      mouse.leftDown     = false;
      mouse.leftReleased = true;
      _fireClickListeners(mouse.x, mouse.y);
    }
    if (e.button === 2) mouse.rightDown = false;
  }

  function onWheel(e) {
    mouse.scrollDelta = Math.sign(e.deltaY);
  }

  // ── Touch ────────────────────────────────────────────────

  function onTouchStart(e) {
    const t = e.touches[0];
    const p = toCanvas(t.clientX, t.clientY);
    mouse.x = p.x; mouse.y = p.y;
    mouse.rawX = t.clientX; mouse.rawY = t.clientY;
    mouse.leftDown    = true;
    mouse.leftPressed = true;
  }

  function onTouchMove(e) {
    const t = e.touches[0];
    const p = toCanvas(t.clientX, t.clientY);
    mouse.x = p.x; mouse.y = p.y;
  }

  function onTouchEnd(e) {
    mouse.leftDown     = false;
    mouse.leftReleased = true;
    _fireClickListeners(mouse.x, mouse.y);
  }

  // ── Canvas click listeners ────────────────────────────────

  /**
   * Register a hit-test region on the canvas.
   * cb is called with (mouseX, mouseY) when a click lands inside rect.
   * If once=true the listener auto-removes after first fire.
   */
  function onCanvasClick(rect, cb, once = false) {
    clickListeners.push({ rect, cb, once });
  }

  /** Remove all canvas click listeners */
  function clearCanvasListeners() {
    clickListeners.length = 0;
  }

  /** Remove listeners whose tag matches */
  function removeCanvasListenersByTag(tag) {
    for (let i = clickListeners.length - 1; i >= 0; i--) {
      if (clickListeners[i].tag === tag) clickListeners.splice(i, 1);
    }
  }

  function _fireClickListeners(cx, cy) {
    const toRemove = [];
    for (let i = 0; i < clickListeners.length; i++) {
      const { rect, cb, once } = clickListeners[i];
      if (Utils.pointInRect(cx, cy, rect.x, rect.y, rect.w, rect.h)) {
        cb(cx, cy);
        if (once) toRemove.push(i);
      }
    }
    // Remove in reverse so indices stay valid
    for (let i = toRemove.length - 1; i >= 0; i--) {
      clickListeners.splice(toRemove[i], 1);
    }
  }

  // ── Public API ───────────────────────────────────────────

  return {
    init,
    setScale,
    beginFrame,
    isHeld,
    isPressed,
    isReleased,
    mouse,
    onCanvasClick,
    clearCanvasListeners,
    removeCanvasListenersByTag,
  };

})();
