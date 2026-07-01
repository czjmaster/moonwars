/* ============================================================
   MOON WARS — assets.js
   Asset pipeline: procedural pixel-art sprite generation.
   All sprites are drawn programmatically onto offscreen
   canvases and stored as ImageBitmap-like CanvasElements.
   No external image files required.
   ============================================================ */

'use strict';

const Assets = (() => {

  // Registry: name → HTMLCanvasElement (sprite sheet or single sprite)
  const _sprites = new Map();

  // ── Pixel art drawing primitives ─────────────────────────

  /** Create an offscreen canvas of given pixel size */
  function _makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Draw a single pixel (scaled) at grid position */
  function _px(ctx, x, y, color, scale = 1) {
    ctx.fillStyle = color;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }

  /** Draw pixel art from a string grid */
  function _drawGrid(ctx, grid, palette, scale = 2) {
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        const ch = grid[row][col];
        if (ch === '.' || ch === ' ') continue;
        const color = palette[ch];
        if (!color) continue;
        _px(ctx, col, row, color, scale);
      }
    }
  }

  // ── Sprite generators ─────────────────────────────────────

  /** Player ship — side view, 3-floor frigate */
  function _genPlayerShip() {
    const SCALE = 3;
    const W = 64, H = 48;
    const c = _makeCanvas(W * SCALE, H * SCALE);
    const ctx = c.getContext('2d');

    const pal = {
      H: '#4a90d9',  // hull light
      h: '#2d5f99',  // hull mid
      D: '#1a3a5c',  // hull dark
      E: '#1aff8c',  // engine glow
      e: '#0f9955',  // engine dim
      W: '#c8d8f0',  // window
      O: '#ff7c20',  // orange accent
      B: '#ff2d44',  // red (weapons)
      G: '#ffd700',  // gold
      K: '#07080f',  // outline
    };

    // Main hull silhouette (64×48 grid)
    const hull = [
      '..............KKKKKK................................................',
      '...........KKHHHHHHHKKK.............................................',
      '.........KKhHHHHHHHHHHHKKK..........................................',
      '.......KKhhhHHHHHHHHHHHHHHKK........................................',
      '......KKhhhHWWWhHHHHHHHHHHHHK.......................................',
      '....KKKhhhHHWWWHHHHHHOHHHHHHHKKK...................................',
      '...KKhhhhhHHHHHHHHHHHOHHHHHHHHHKK..................................',
      '..KKhhhhhHHHHHHHHHHHHHHHHHHHHHHHHK.................................',
      '.KKhhhhhHHHHHHHHHHHHHHHHHHHHHHHHHHKK...............................',
      'KKhhhhhHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKKKKKKKKK......................',
      'KhhhhhhHHHWWWHHHHOHHHHHHHHHHHHHHHHHHHHHHHHHHHKKK...................',
      'KhhhhhhHHHWWWHHHHOHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHK..................',
      'KKhhhhhHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKKKKKKKKKKKKKKK...',
      '.KKhhhhhHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKK.',
      '..KKhhhhhHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHK..',
      '...KKKhhhHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKK...',
      '.....KKKhHHHHHHHWWWHHHHOHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKK....',
      '......KKKhHHHHHHWWWHHHHOHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKKK.....',
      '.......KKKKhHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKKK.......',
      '.........KKKKhHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKKKKKK.........',
      '...........KKKKKhHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHKKKKKK.............',
      '.............KKKKKhhhHHHHHHHHHHHHHHHHHHhhKKKKKK...................',
      '...EEE........KKKKKhhhhhhhhhhhhhhhhhhhKKKK......................',
      '..eEEe..........KKKKKhhhhhhhhhhhhhKKKKK.....................',
      '...eee...............KKKKKKKKKKKKKK.......................',
    ];

    _drawGrid(ctx, hull, pal, SCALE);
    return c;
  }

  /** Enemy frigate variant */
  function _genEnemyShip() {
    const SCALE = 3;
    const W = 56, H = 40;
    const c = _makeCanvas(W * SCALE, H * SCALE);
    const ctx = c.getContext('2d');

    // Simple angular enemy design in red/grey
    const pal = {
      H: '#8b2020', h: '#5a1515', D: '#2d0a0a',
      E: '#ff4444', e: '#aa2222',
      W: '#ffaaaa', O: '#ff7700', K: '#07080f',
    };

    const hull = [
      '................KKKK....',
      '..............KKhHHKK...',
      '............KKhHHHHHKK..',
      '..........KKhhHHHHHHHKK.',
      '.........KKhhHHWHHHHHHK.',
      '........KKhhHHHHHHHHHHHKKKKKK',
      '.......KKhhHHHHHHHHHHHHHHHHHKKK',
      '......KKhhHHHHHOHHHHHHHHHHHHHHHKKKKK',
      '...KKKKKHHHHHHHOHHHHHHHHHHHHHHHHHHHHHHKKK',
      '..KKhhHHHHHHHOHHHHHHHHHHHHHHHHHHHHHHHHK',
      '...KKKKhHHHHHHHHHHHHHHHHHHHHHHHHHHHHKKK',
      '......KKhhHHHHHHHHHHHHHHHHHHHHHKKKKK',
      '.......KKhhHHHHOHHHHHHHHHHHHKKK',
      '........KKhhHHHHHHHHHHHHHKK',
      '.........KKhhHHWHHHHHHKK',
      '..........KKhhHHHHHHKK',
      '...........KKhhHHHKK',
      '............KKKhKK',
      'EE...............KKK',
      'eEe',
    ];

    _drawGrid(ctx, hull, pal, SCALE);
    return c;
  }

  /** Boss ship — large cruiser */
  function _genBossShip() {
    const SCALE = 4;
    const c = _makeCanvas(80 * SCALE, 56 * SCALE);
    const ctx = c.getContext('2d');

    const pal = {
      H: '#3a1f6e', h: '#241244', D: '#0f0820',
      E: '#cc44ff', e: '#7722aa',
      W: '#ddaaff', O: '#ff7700', B: '#ff2244',
      K: '#07080f', G: '#ffd700',
    };

    // Boss design: wide intimidating cruiser
    ctx.fillStyle = pal.D;
    ctx.fillRect(0, 0, 80 * SCALE, 56 * SCALE);

    // Main body
    const body = [
      [5,20,70,16],
      [10,15,60,4],
      [10,36,60,4],
    ];
    ctx.fillStyle = pal.h;
    body.forEach(([x,y,w,h]) => ctx.fillRect(x*SCALE,y*SCALE,w*SCALE,h*SCALE));

    // Highlights
    ctx.fillStyle = pal.H;
    ctx.fillRect(10*SCALE, 21*SCALE, 60*SCALE, 2*SCALE);
    ctx.fillRect(10*SCALE, 33*SCALE, 60*SCALE, 2*SCALE);

    // Windows
    ctx.fillStyle = pal.W;
    [15,25,35,45,55].forEach(x => {
      ctx.fillRect(x*SCALE, 23*SCALE, 3*SCALE, 3*SCALE);
      ctx.fillRect(x*SCALE, 30*SCALE, 3*SCALE, 3*SCALE);
    });

    // Orange accent stripe
    ctx.fillStyle = pal.O;
    ctx.fillRect(5*SCALE, 27*SCALE, 70*SCALE, 2*SCALE);

    // Engine glow
    ctx.fillStyle = pal.e;
    ctx.fillRect(0, 22*SCALE, 6*SCALE, 12*SCALE);
    ctx.fillStyle = pal.E;
    ctx.fillRect(1*SCALE, 24*SCALE, 4*SCALE, 8*SCALE);

    // Weapon mounts
    ctx.fillStyle = pal.B;
    [22, 42, 62].forEach(y => {
      ctx.fillRect(72*SCALE, y*SCALE, 8*SCALE, 4*SCALE);
    });

    return c;
  }

  /** 32×32 crew sprite - idle pose */
  function _genCrewSprite(color = '#4db8ff') {
    const S = 2;
    const c = _makeCanvas(32 * S, 32 * S);
    const ctx = c.getContext('2d');

    const pal = {
      H: color,
      h: '#1a3a5c',
      S: '#c8d8f0',  // skin
      s: '#a0b0c0',
      V: '#ff7c20',  // visor
      B: '#07080f',
    };

    const sprite = [
      '....BBBBBB....',
      '...BHHhhhHB...',
      '..BHHVVVVhHB..',
      '..BHHVVVVhHB..',
      '..BHHhhhhhHB..',
      '...BBBBBBBB...',
      '..BSSSSSSSSB..',
      '.BSShHHHHHssB.',
      'BSSHHHHHHHHssB',
      'BSSHHHHHHHHssB',
      'BSSHHHHHHHHssB',
      '.BSShHHHHHssB.',
      '..BBBBBBBBBB..',
      '..BSSB..BSSB..',
      '..BSSB..BSSB..',
      '..BSBB..BBSB..',
    ];

    _drawGrid(ctx, sprite, pal, S);
    return c;
  }

  /** 32×32 crew — enemy */
  function _genEnemyCrewSprite() {
    return _genCrewSprite('#ff2d44');
  }

  /** System icon — 24×24 pixel art */
  function _genSystemIcon(type) {
    const S = 2;
    const c = _makeCanvas(24 * S, 24 * S);
    const ctx = c.getContext('2d');

    const icons = {
      shields: [
        '....BBBBBBBB....',
        '..BBhHHHHHHhBB..',
        '.BhHHHHHHHHHHhB.',
        'BhHHHHHHHHHHHHhB',
        'BhHHHHHHHHHHHHhB',
        'BhHHHHHHHHHHHHhB',
        '.BhHHHHHHHHHHhB.',
        '..BBhHHHHHHhBB..',
        '....BBBBBBBB....',
      ],
      weapons: [
        '...BB...........',
        '..BhhB..........',
        '.BhOOhBBBBBBBBB.',
        'BhOOOOOOOOOOOOhB',
        '.BhOOhBBBBBBBBB.',
        '..BhhB..........',
        '...BB...........',
      ],
      engines: [
        '....BBBB........',
        '..BBEEEeBB......',
        '.BEEEEEEEeB.....',
        'BEEEEEEEEEeB....',
        'BEEEEEEEEEeB....',
        '.BEEEEEEEeB.....',
        '..BBEEEeBB......',
        '....BBBB........',
      ],
      oxygen: [
        '....BBBBBBBB....',
        '..BBaaaaaaaaBB..',
        '.BaaaaaaaaaaaB..',
        'BaaaBBBBBBBBaaB.',
        'BaaaBBBBBBBBaaB.',
        '.BaaaaaaaaaBB...',
        '..BBaaaaaBB.....',
        '....BBBB........',
      ],
      medbay: [
        '....BBBBBBBB....',
        '..BBGGGGGGGgBB..',
        '.BGGGGgGGGGGGgB.',
        'BGGGgggGGGGGGGgB',
        'BGGGgggGGGGGGGgB',
        '.BGGGGgGGGGGGgB.',
        '..BBGGGGGGGgBB..',
        '....BBBBBBBB....',
      ],
      piloting: [
        '.....BBBBB......',
        '...BBwwwwwBB....',
        '..BwwwwwwwwwB...',
        '.BwwwBBBBwwwwB..',
        'BwwwBBBBBBwwwwB.',
        'BwwwBBBBBBwwwwB.',
        '.BwwwBBBBwwwwB..',
        '..BwwwwwwwwwB...',
        '...BBwwwwwBB....',
        '.....BBBBB......',
      ],
    };

    const palettes = {
      shields: { B:'#07080f', H:'#4db8ff', h:'#1a5a99' },
      weapons: { B:'#07080f', O:'#ff7c20', h:'#aa4400' },
      engines: { B:'#07080f', E:'#1aff8c', e:'#0f9955' },
      oxygen:  { B:'#07080f', a:'#88ccff', A:'#4488aa' },
      medbay:  { B:'#07080f', G:'#1aff8c', g:'#00aa66' },
      piloting:{ B:'#07080f', w:'#ffd700', W:'#aa8800' },
    };

    const grid = icons[type] || icons.shields;
    const pal  = palettes[type] || palettes.shields;
    _drawGrid(ctx, grid, pal, S);
    return c;
  }

  /** Generic room tile — 48×48 */
  function _genRoomTile(type = 'default') {
    const S = 3;
    const c = _makeCanvas(16 * S, 16 * S);
    const ctx = c.getContext('2d');

    const colors = {
      default:  { floor: '#0d1828', wall: '#1a2a3a', edge: '#0a1520', line: '#1e3048' },
      shields:  { floor: '#0a1428', wall: '#112244', edge: '#070e22', line: '#1a3366' },
      weapons:  { floor: '#1a0e08', wall: '#2a1808', edge: '#120800', line: '#3a2010' },
      engines:  { floor: '#0a180e', wall: '#0f2414', edge: '#071008', line: '#184820' },
      oxygen:   { floor: '#080e1a', wall: '#0c1428', edge: '#050a14', line: '#102030' },
      medbay:   { floor: '#08180e', wall: '#0e2814', edge: '#051008', line: '#1a4820' },
      piloting: { floor: '#181208', wall: '#281a0a', edge: '#100c04', line: '#3a2a10' },
    };

    const col = colors[type] || colors.default;

    // Floor
    ctx.fillStyle = col.floor;
    ctx.fillRect(0, 0, 16*S, 16*S);

    // Wall border
    ctx.fillStyle = col.wall;
    ctx.fillRect(0, 0, 16*S, S);
    ctx.fillRect(0, 15*S, 16*S, S);
    ctx.fillRect(0, 0, S, 16*S);
    ctx.fillRect(15*S, 0, S, 16*S);

    // Corner bolts
    ctx.fillStyle = col.edge;
    [0, 15].forEach(cx => [0, 15].forEach(cy => {
      ctx.fillRect(cx*S, cy*S, S, S);
    }));

    // Floor grid lines
    ctx.fillStyle = col.line;
    ctx.fillRect(4*S, S, S, 14*S);
    ctx.fillRect(8*S, S, S, 14*S);
    ctx.fillRect(12*S, S, S, 14*S);
    ctx.fillRect(S, 4*S, 14*S, S);
    ctx.fillRect(S, 8*S, 14*S, S);
    ctx.fillRect(S, 12*S, 14*S, S);

    return c;
  }

  /** Weapon projectile sprites */
  function _genProjectile(type = 'laser') {
    const c = _makeCanvas(24, 8);
    const ctx = c.getContext('2d');

    if (type === 'laser') {
      // Glowing laser bolt
      const grad = ctx.createLinearGradient(0,0,24,0);
      grad.addColorStop(0, 'rgba(26,140,255,0)');
      grad.addColorStop(0.3, 'rgba(26,140,255,0.8)');
      grad.addColorStop(0.7, 'rgba(77,184,255,1)');
      grad.addColorStop(1, 'rgba(200,230,255,1)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 2, 24, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(18, 3, 6, 2);
    } else if (type === 'missile') {
      ctx.fillStyle = '#888';
      ctx.fillRect(2, 3, 16, 2);
      ctx.fillStyle = '#ff7700';
      ctx.fillRect(0, 1, 4, 6);
      ctx.fillStyle = '#ffcc00';
      ctx.fillRect(18, 2, 6, 4);
    } else if (type === 'cannon') {
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(12, 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(11, 3, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    return c;
  }

  /** Particle sprites (16×16) */
  function _genParticleSheet() {
    const S = 1;
    const W = 16 * 8, H = 16;
    const c = _makeCanvas(W, H);
    const ctx = c.getContext('2d');

    const types = [
      { color: '#ff7c20', glow: '#ff4400' },  // 0: fire spark
      { color: '#4db8ff', glow: '#1a8cff' },  // 1: shield hit
      { color: '#1aff8c', glow: '#00cc66' },  // 2: repair
      { color: '#ffd700', glow: '#ff9900' },  // 3: scrap
      { color: '#ff2d44', glow: '#aa0020' },  // 4: explosion
      { color: '#ccddff', glow: '#8899cc' },  // 5: smoke
      { color: '#ffffff', glow: '#aaccff' },  // 6: laser hit
      { color: '#cc44ff', glow: '#8800cc' },  // 7: energy
    ];

    types.forEach((t, i) => {
      const x = i * 16;
      // Glow
      const grad = ctx.createRadialGradient(x+8,8,0,x+8,8,8);
      grad.addColorStop(0, t.glow);
      grad.addColorStop(0.5, t.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, 16, 16);
      // Core pixel
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x+7, 7, 2, 2);
    });

    return c;
  }

  /** UI panel / button background tiles */
  function _genUIPanels() {
    const c = _makeCanvas(256, 64);
    const ctx = c.getContext('2d');

    // Normal button
    ctx.fillStyle = '#0d1120';
    ctx.beginPath();
    ctx.roundRect(2, 2, 60, 28, 4);
    ctx.fill();
    ctx.strokeStyle = '#1e2d4a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Active button
    ctx.fillStyle = 'rgba(26,140,255,0.15)';
    ctx.beginPath();
    ctx.roundRect(66, 2, 60, 28, 4);
    ctx.fill();
    ctx.strokeStyle = '#1a8cff';
    ctx.lineWidth = 1;
    ctx.stroke();

    return c;
  }

  /** Star background layer */
  function _genStarfield(density = 120) {
    const c = _makeCanvas(1280, 720);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0, 0, 1280, 720);

    // Distant stars
    for (let i = 0; i < density; i++) {
      const x = Utils.randInt(0, 1280);
      const y = Utils.randInt(0, 720);
      const r = Math.random() < 0.1 ? 1.5 : 0.5;
      const alpha = Utils.randFloat(0.3, 1.0);
      const hue = Utils.randInt(180, 260);
      ctx.fillStyle = `hsla(${hue}, 60%, 90%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Nebula wisps
    for (let i = 0; i < 5; i++) {
      const x = Utils.randInt(100, 1180);
      const y = Utils.randInt(100, 620);
      const grad = ctx.createRadialGradient(x,y,0,x,y,Utils.randInt(60,200));
      const hue  = Utils.pick([200, 260, 290, 180]);
      grad.addColorStop(0, `hsla(${hue},80%,40%,0.06)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1280, 720);
    }

    return c;
  }

  /** Moon background */
  function _genMoon() {
    const c = _makeCanvas(200, 200);
    const ctx = c.getContext('2d');

    // Moon body
    const grad = ctx.createRadialGradient(80,80,0,100,100,100);
    grad.addColorStop(0, '#d0d8e8');
    grad.addColorStop(0.6, '#8090a0');
    grad.addColorStop(1, '#202830');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(100, 100, 98, 0, Math.PI * 2);
    ctx.fill();

    // Craters
    const craters = [[60,70,15],[130,90,20],[80,140,10],[150,60,8],[50,120,12]];
    craters.forEach(([x,y,r]) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.arc(x-2,y-2,r*0.4,0,Math.PI*2); ctx.fill();
    });

    return c;
  }

  /** Shield visual ring */
  function _genShieldRing() {
    const c = _makeCanvas(256, 128);
    const ctx = c.getContext('2d');
    const cx = 128, cy = 64, rx = 120, ry = 56;

    for (let t = 0; t < Math.PI * 2; t += 0.05) {
      const x = cx + Math.cos(t) * rx;
      const y = cy + Math.sin(t) * ry;
      const alpha = 0.4 + 0.3 * Math.sin(t * 3);
      ctx.fillStyle = `rgba(77,184,255,${alpha})`;
      ctx.fillRect(x-1, y-1, 2, 2);
    }

    return c;
  }

  /** Health bar spritesheet (used for room HP, shields, etc.) */
  function _genBarSprites() {
    const c = _makeCanvas(120, 16);
    const ctx = c.getContext('2d');

    // Full bar segments in 3 colors
    [['#1aff8c', 0], ['#ff7c20', 40], ['#ff2d44', 80]].forEach(([col, ox]) => {
      ctx.fillStyle = '#07080f';
      ctx.fillRect(ox, 0, 36, 12);
      ctx.fillStyle = col;
      ctx.fillRect(ox+1, 1, 34, 10);
    });

    return c;
  }

  // ── Elevator shaft tile ───────────────────────────────────

  function _genElevatorTile() {
    const S = 3;
    const c = _makeCanvas(8 * S, 32 * S);
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, 8*S, 32*S);
    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(S, 0, 2*S, 32*S);
    ctx.fillRect(5*S, 0, 2*S, 32*S);
    // Rungs
    for (let y = 2; y < 30; y += 4) {
      ctx.fillStyle = '#2a3a4a';
      ctx.fillRect(S, y*S, 6*S, S);
    }

    return c;
  }

  // ── Init / load all sprites ───────────────────────────────

  async function init(onProgress) {
    const tasks = [
      ['ship_player',  _genPlayerShip],
      ['ship_enemy',   _genEnemyShip],
      ['ship_boss',    _genBossShip],
      ['crew_player',  () => _genCrewSprite('#4db8ff')],
      ['crew_engineer',() => _genCrewSprite('#1aff8c')],
      ['crew_soldier', () => _genCrewSprite('#ffd700')],
      ['crew_enemy',   _genEnemyCrewSprite],
      ['icon_shields', () => _genSystemIcon('shields')],
      ['icon_weapons', () => _genSystemIcon('weapons')],
      ['icon_engines', () => _genSystemIcon('engines')],
      ['icon_oxygen',  () => _genSystemIcon('oxygen')],
      ['icon_medbay',  () => _genSystemIcon('medbay')],
      ['icon_piloting',() => _genSystemIcon('piloting')],
      ['room_default', () => _genRoomTile('default')],
      ['room_shields', () => _genRoomTile('shields')],
      ['room_weapons', () => _genRoomTile('weapons')],
      ['room_engines', () => _genRoomTile('engines')],
      ['room_oxygen',  () => _genRoomTile('oxygen')],
      ['room_medbay',  () => _genRoomTile('medbay')],
      ['room_piloting',() => _genRoomTile('piloting')],
      ['proj_laser',   () => _genProjectile('laser')],
      ['proj_missile', () => _genProjectile('missile')],
      ['proj_cannon',  () => _genProjectile('cannon')],
      ['particles',    _genParticleSheet],
      ['ui_panels',    _genUIPanels],
      ['bg_stars',     _genStarfield],
      ['bg_moon',      _genMoon],
      ['shield_ring',  _genShieldRing],
      ['bar_sprites',  _genBarSprites],
      ['elevator',     _genElevatorTile],
    ];

    for (let i = 0; i < tasks.length; i++) {
      const [name, fn] = tasks[i];
      _sprites.set(name, fn());
      if (onProgress) onProgress((i + 1) / tasks.length, `Loading ${name}…`);
      // Yield to browser between tasks
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // ── Public API ────────────────────────────────────────────

  function get(name) {
    const s = _sprites.get(name);
    if (!s) console.warn(`[Assets] Sprite not found: ${name}`);
    return s || null;
  }

  function has(name) { return _sprites.has(name); }

  /**
   * Draw a sprite onto a canvas context.
   * sx,sy = source sprite-sheet offset (0 for single sprites).
   */
  function draw(ctx, name, dx, dy, dw, dh, sx = 0, sy = 0, sw = null, sh = null) {
    const sprite = get(name);
    if (!sprite) return;
    const srcW = sw ?? sprite.width;
    const srcH = sh ?? sprite.height;
    ctx.drawImage(sprite, sx, sy, srcW, srcH,
                          dx, dy, dw ?? srcW, dh ?? srcH);
  }

  return { init, get, has, draw };

})();
