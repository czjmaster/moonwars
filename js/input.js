/* ============================================================
   MOON WARS — input.js
   Centralised keyboard + mouse input manager.
   ============================================================ */

'use strict';

const Input = (() => {

  const keys     = new Set();
  const pressed  = new Set();
  const released = new Set();

  const mouse = {
    x: 0, y: 0,
    rawX: 0, rawY: 0,
    leftDown: false,
    rightDown: false,
    leftPressed: false,
    leftReleased: false,
    scrollDelta: 0,
  };

  // Pending event buffers — events fire between frames;
  // beginFrame() transfers these into the per-frame flags.
  let _pendingPress   = false;
  let _pendingRelease = false;
  let _pendingScroll  = 0;
  const _pendingKeys     = new Set();
  const _pendingReleases = new Set();

  const clickListeners = [];
  let canvas = null;

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
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: true });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });
  }

  // Kept for API compatibility — no longer used internally
  function setScale(sx, sy) {}

  // ── Convert client coords → canvas game coords ────────────
  // Canvas internal size is always 1280x720.
  // CSS scales it to fit the window.
  // We must divide by the CSS scale factor.

  function toCanvas(clientX, clientY) {
    if (!canvas) return { x: clientX, y: clientY };
    const rect   = canvas.getBoundingClientRect();
    // rect.width/height = CSS display size
    // canvas.width/height = internal game resolution (1280x720)
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    };
  }

  // ── Per-frame flush ───────────────────────────────────────

  function beginFrame() {
    // Transfer pending event data into per-frame flags
    pressed.clear();
    released.clear();
    _pendingKeys.forEach(k => pressed.add(k));
    _pendingReleases.forEach(k => released.add(k));
    _pendingKeys.clear();
    _pendingReleases.clear();

    mouse.leftPressed  = _pendingPress;
    mouse.leftReleased = _pendingRelease;
    mouse.scrollDelta  = _pendingScroll;
    _pendingPress   = false;
    _pendingRelease = false;
    _pendingScroll  = 0;
  }

  // ── Keyboard ─────────────────────────────────────────────

  function onKeyDown(e) {
    if (!keys.has(e.code)) _pendingKeys.add(e.code);
    keys.add(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
    _pendingReleases.add(e.code);
  }

  function isHeld(code)     { return keys.has(code); }
  function isPressed(code)  { return pressed.has(code); }
  function isReleased(code) { return released.has(code); }

  // ── Mouse ────────────────────────────────────────────────

  function onMouseMove(e) {
    mouse.rawX = e.clientX;
    mouse.rawY = e.clientY;
    const p    = toCanvas(e.clientX, e.clientY);
    mouse.x    = p.x;
    mouse.y    = p.y;
  }

  function onMouseDown(e) {
    if (e.button === 0) { mouse.leftDown = true; _pendingPress = true; }
    if (e.button === 2) mouse.rightDown = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) {
      mouse.leftDown  = false;
      _pendingRelease = true;
      _fireClickListeners(mouse.x, mouse.y);
    }
    if (e.button === 2) mouse.rightDown = false;
  }

  function onWheel(e) {
    _pendingScroll = Math.sign(e.deltaY);
  }

  // ── Touch ────────────────────────────────────────────────

  function onTouchStart(e) {
    const t = e.touches[0];
    const p = toCanvas(t.clientX, t.clientY);
    mouse.x = p.x; mouse.y = p.y;
    mouse.leftDown = true; _pendingPress = true;
  }

  function onTouchMove(e) {
    const t = e.touches[0];
    const p = toCanvas(t.clientX, t.clientY);
    mouse.x = p.x; mouse.y = p.y;
  }

  function onTouchEnd(e) {
    mouse.leftDown  = false;
    _pendingRelease = true;
    _fireClickListeners(mouse.x, mouse.y);
  }

  // ── Canvas click listeners ────────────────────────────────

  function onCanvasClick(rect, cb, once = false) {
    clickListeners.push({ rect, cb, once });
  }

  function clearCanvasListeners() {
    clickListeners.length = 0;
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
  };

})();
