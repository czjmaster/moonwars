/* ============================================================
   MOON WARS — camera.js
   2D camera with smooth pan and zoom.
   Wraps canvas context transforms so all game-world
   drawing goes through camera space.
   ============================================================ */

'use strict';

const Camera = (() => {

  let _x    = 0;      // world-space target
  let _y    = 0;
  let _cx   = 0;      // current (smoothed) position
  let _cy   = 0;
  let _zoom = 1;
  let _czoom= 1;

  let _canvasW = 1280;
  let _canvasH = 720;

  // Shake state
  let _shakeAmt  = 0;
  let _shakeDur  = 0;
  let _shakeElap = 0;
  let _shakeX    = 0;
  let _shakeY    = 0;

  const SMOOTH = 6;   // pan smoothing factor (higher = snappier)

  // ── Setup ────────────────────────────────────────────────

  function resize(w, h) { _canvasW = w; _canvasH = h; }

  // ── Control ───────────────────────────────────────────────

  /** Instantly jump to world position */
  function jumpTo(x, y) { _x = _cx = x; _y = _cy = y; }

  /** Smoothly pan to world position */
  function moveTo(x, y) { _x = x; _y = y; }

  /** Set zoom level (1 = no zoom) */
  function setZoom(z) { _zoom = Utils.clamp(z, 0.25, 4); }

  /** Screen shake */
  function shake(amount = 8, duration = 0.3) {
    _shakeAmt  = amount;
    _shakeDur  = duration;
    _shakeElap = 0;
  }

  // ── Update ───────────────────────────────────────────────

  function update(dt) {
    // Smooth follow
    _cx = Utils.lerp(_cx, _x, Utils.clamp(SMOOTH * dt, 0, 1));
    _cy = Utils.lerp(_cy, _y, Utils.clamp(SMOOTH * dt, 0, 1));
    _czoom = Utils.lerp(_czoom, _zoom, Utils.clamp(SMOOTH * dt, 0, 1));

    // Shake
    _shakeX = 0; _shakeY = 0;
    if (_shakeElap < _shakeDur) {
      _shakeElap += dt;
      const intensity = _shakeAmt * (1 - _shakeElap / _shakeDur);
      _shakeX = (Math.random() * 2 - 1) * intensity;
      _shakeY = (Math.random() * 2 - 1) * intensity;
    }
  }

  // ── Canvas transform helpers ──────────────────────────────

  /** Apply camera transform. Call before drawing world objects. */
  function begin(ctx) {
    ctx.save();
    ctx.translate(
      _canvasW / 2 + _shakeX - _cx * _czoom,
      _canvasH / 2 + _shakeY - _cy * _czoom
    );
    ctx.scale(_czoom, _czoom);
  }

  /** Restore canvas transform. */
  function end(ctx) {
    ctx.restore();
  }

  // ── Coordinate conversion ─────────────────────────────────

  /** World → screen */
  function worldToScreen(wx, wy) {
    return {
      x: (wx - _cx) * _czoom + _canvasW / 2 + _shakeX,
      y: (wy - _cy) * _czoom + _canvasH / 2 + _shakeY,
    };
  }

  /** Screen → world */
  function screenToWorld(sx, sy) {
    return {
      x: (sx - _canvasW / 2 - _shakeX) / _czoom + _cx,
      y: (sy - _canvasH / 2 - _shakeY) / _czoom + _cy,
    };
  }

  /** Is a world-space rect visible on screen? (culling) */
  function isVisible(wx, wy, ww, wh, margin = 64) {
    const s = worldToScreen(wx, wy);
    return (
      s.x + ww * _czoom + margin > 0 &&
      s.x - margin < _canvasW &&
      s.y + wh * _czoom + margin > 0 &&
      s.y - margin < _canvasH
    );
  }

  // ── Getters ──────────────────────────────────────────────

  function getX()    { return _cx; }
  function getY()    { return _cy; }
  function getZoom() { return _czoom; }

  // ── Public API ───────────────────────────────────────────

  return {
    resize, jumpTo, moveTo, setZoom, shake,
    update, begin, end,
    worldToScreen, screenToWorld, isVisible,
    getX, getY, getZoom,
  };

})();
