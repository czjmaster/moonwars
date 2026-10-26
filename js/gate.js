'use strict';
/* ============================================================
   MOON WARS — gate.js  (update171a)
   A password in front of the game (jj 26.10: "żeby nie było, że każdy
   wchodzi do gry — trzeba tam hasło wprowadzić").

   What it is: a curtain, not a lock. The site is static (GitHub Pages),
   so anything the browser runs can be read by someone who knows where
   to look. It keeps casual visitors and link-forwarders out; real access
   control is the planned move to Cloudflare Pages + Access (HQ task
   z-cloudflare-access).

   - The password is stored only as a hash (`HASH`), never in clear text.
   - Typing is forgiving: spaces around it and letter case do not matter.
   - A correct password is remembered in localStorage, so the curtain
     shows once per browser.
   - Automated browsers (navigator.webdriver — the Playwright test) pass
     straight through, so the real-browser test keeps driving the game.
   - While the curtain is up, no click, key or wheel reaches the game.
   ============================================================ */

const MoonGate = (() => {
  const KEY = 'moonwars_gate_v1';
  const SALT = 'moonwars:maat:';
  const ROUNDS = 777;
  /* hash(norm(password)) — change the password by changing this line
     (node -e "...MoonGate.hash(MoonGate.norm('new'))" prints the value). */
  const HASH = 'eb29142d';

  let _locked = false;
  let _overlay = null;

  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

  /** FNV-1a 32-bit, salted and repeated: enough to keep the word out of the source. */
  function hash(s) {
    let txt = SALT + String(s);
    let h = 0x811c9dc5;
    for (let r = 0; r < ROUNDS; r++) {
      for (let i = 0; i < txt.length; i++) {
        h ^= txt.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      txt = h.toString(16);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function check(pw) { return hash(norm(pw)) === HASH; }

  function _storage(win) {
    try { return win && win.localStorage ? win.localStorage : null; } catch (e) { return null; }
  }

  function isUnlocked(win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    if (!win) return true;
    try { if (win.navigator && win.navigator.webdriver) return true; } catch (e) { /* none */ }
    const st = _storage(win);
    try { return !!st && st.getItem(KEY) === HASH; } catch (e) { return false; }
  }

  function remember(win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    const st = _storage(win);
    try { if (st) st.setItem(KEY, HASH); } catch (e) { /* private window: ask again next time */ }
  }

  const STOP_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel',
    'pointerdown', 'pointerup', 'pointermove', 'mousemove', 'touchstart', 'touchmove', 'touchend'];
  const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

  /** Builds the curtain. Returns the overlay element, or null when already unlocked. */
  function mount(doc, win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    if (!doc || isUnlocked(win)) { _locked = false; return null; }
    _locked = true;

    const ov = doc.createElement('div');
    ov.id = 'moon-gate';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Moon Wars access');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
      'justify-content:center;background:radial-gradient(circle at 50% 35%,#16202c 0%,#05070a 70%);' +
      'font-family:"Courier New",monospace;color:#cfe6ff;';

    const box = doc.createElement('form');
    box.style.cssText = 'display:flex;flex-direction:column;gap:12px;align-items:stretch;width:min(340px,86vw);' +
      'padding:26px 24px;border:1px solid #2c4a66;border-radius:8px;background:rgba(8,14,22,.92);' +
      'box-shadow:0 0 40px rgba(80,170,255,.15);';

    const title = doc.createElement('div');
    title.textContent = 'MOON WARS';
    title.style.cssText = 'font-size:26px;letter-spacing:.3em;text-align:center;color:#ffd27a;';

    const sub = doc.createElement('div');
    sub.textContent = 'Closed preview — enter the access code';
    sub.style.cssText = 'font-size:12px;text-align:center;color:#7f97b0;';

    const input = doc.createElement('input');
    input.type = 'password';
    input.id = 'moon-gate-input';
    input.autocomplete = 'current-password';
    input.setAttribute('aria-label', 'Access code');
    input.style.cssText = 'padding:10px 12px;font:inherit;font-size:16px;color:#e8f3ff;background:#0d1724;' +
      'border:1px solid #3a5a7a;border-radius:5px;outline:none;';

    const btn = doc.createElement('button');
    btn.type = 'submit';
    btn.textContent = 'ENTER';
    btn.style.cssText = 'padding:10px;font:inherit;font-size:14px;letter-spacing:.2em;color:#05070a;' +
      'background:#ffd27a;border:0;border-radius:5px;cursor:pointer;';

    const err = doc.createElement('div');
    err.id = 'moon-gate-error';
    err.textContent = '';
    err.style.cssText = 'min-height:16px;font-size:12px;text-align:center;color:#ff7a7a;';

    box.appendChild(title); box.appendChild(sub); box.appendChild(input);
    box.appendChild(btn); box.appendChild(err);
    ov.appendChild(box);

    // nothing from the curtain reaches the game's listeners on window/document
    const swallow = (e) => { if (e.stopPropagation) e.stopPropagation(); };
    STOP_EVENTS.forEach(t => ov.addEventListener(t, swallow));
    KEY_EVENTS.forEach(t => input.addEventListener(t, swallow));
    // keys typed anywhere else are held back too (capture: before the game sees them)
    const holdKeys = (e) => {
      if (!_locked || e.target === input) return;
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.preventDefault) e.preventDefault();
    };
    if (win && win.addEventListener) KEY_EVENTS.forEach(t => win.addEventListener(t, holdKeys, true));

    const submit = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (!check(input.value)) {
        err.textContent = 'Wrong access code.';
        input.value = '';
        return false;
      }
      remember(win);
      _locked = false;
      if (win && win.removeEventListener) KEY_EVENTS.forEach(t => win.removeEventListener(t, holdKeys, true));
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      _overlay = null;
      return true;
    };
    box.addEventListener('submit', submit);
    ov._submit = submit; // for the tests

    (doc.body || doc.documentElement).appendChild(ov);
    _overlay = ov;
    try { input.focus(); } catch (e) { /* none */ }
    return ov;
  }

  return { KEY, HASH, norm, hash, check, isUnlocked, remember, mount,
    isLocked: () => _locked, overlay: () => _overlay };
})();

if (typeof window !== 'undefined') {
  window.MoonGate = MoonGate;
  if (typeof document !== 'undefined' && document.body) MoonGate.mount(document, window);
}
