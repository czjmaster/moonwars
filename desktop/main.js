'use strict';
/* ============================================================
   MOON WARS — desktop/main.js  (update247)
   The Steam/desktop wrapper (jj 21.11: „próbne opakowanie Electron —
   zrób, zobaczymy”). The SAME game as the web build: index.html, css,
   js and art are served to a Chromium window through an `app://game/`
   scheme, so fetch() of the manifest and the sounds works exactly as it
   does on a web server (file:// would refuse it). Saves stay in
   localStorage, which Electron keeps on disk in the user's profile
   (%APPDATA%\MoonWars on Windows).

   F11 or Alt+Enter — full screen. F12 — developer tools (trial build).
   ============================================================ */

const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

/* Where the game lives: next to this file in a packed build
   (build.js copies it into ./game), the repo root when run from source. */
const ROOT = fs.existsSync(path.join(__dirname, 'game', 'index.html'))
  ? path.join(__dirname, 'game')
  : path.join(__dirname, '..');

app.setName('MoonWars');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

/** app://game/<path> → a file under ROOT, never outside it. */
function serve(request) {
  let rel = '/index.html';
  try { rel = decodeURIComponent(new URL(request.url).pathname) || '/index.html'; } catch (e) { /* default */ }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600,
    backgroundColor: '#000000',
    title: 'Moon Wars',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen()); e.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools(); e.preventDefault();
    }
  });
  // Links out of the game (none today) open in the player's browser, not in the game window.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://game/')) { e.preventDefault(); shell.openExternal(url); }
  });

  win.loadURL('app://game/index.html');
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('app', serve);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
