'use strict';
/* MOON WARS — desktop/preload.js (update247)
   Tells the page it runs in the desktop build. The password curtain
   (gate.js) is for the public web page only — a bought copy has no
   password. Nothing else of Node or Electron reaches the page. */
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('MoonDesktop', Object.freeze({ desktop: true, platform: process.platform }));
