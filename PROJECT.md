# MOON WARS — PROJECT.md

> Tactical space survival game inspired by FTL.  
> Browser-only. HTML5 Canvas2D. No external engines.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)  
2. [File Map](#file-map)  
3. [Game States & Flow](#game-states--flow)  
4. [Implemented Gameplay Mechanics](#implemented-gameplay-mechanics)  
5. [Systems Reference](#systems-reference)  
6. [Weapons Reference](#weapons-reference)  
7. [Crew & Skills](#crew--skills)  
8. [Map & Sectors](#map--sectors)  
9. [Station Shop](#station-shop)  
10. [Save System](#save-system)  
11. [Rendering Pipeline](#rendering-pipeline)  
12. [Audio System](#audio-system)  
13. [Asset Pipeline](#asset-pipeline)  
14. [Known Limitations / Next Steps](#known-limitations--next-steps)

---

## Architecture Overview

```
index.html
│
├── css/
│   ├── ui.css        — root tokens, loading screen, body
│   ├── hud.css       — tooltip, notification, pause overlay
│   └── station.css   — station / shop DOM overlay
│
└── js/               — load order = dependency order (no bundler)
    ├── utils.js      — math, timers, DOM helpers (no deps)
    ├── input.js      — keyboard + mouse + canvas click registry
    ├── audio.js      — Web Audio API, procedural SFX + music
    ├── assets.js     — procedural pixel-art sprite pipeline
    ├── particles.js  — pooled particle system (600 particles)
    ├── animation.js  — frame-by-frame animation + Tween class
    ├── camera.js     — 2D camera: pan, zoom, shake
    ├── save.js       — localStorage persistence
    ├── crew.js       — CrewMember class, skills, AI tasks
    ├── systems.js    — ShipSystem class, Reactor
    ├── weapons.js    — Weapon + Projectile classes, defs
    ├── oxygen.js     — per-room O2 simulation
    ├── fire.js       — fire spread, suppression
    ├── breach.js     — hull breach, sealing
    ├── elevator.js   — multi-floor shaft system
    ├── ship.js       — Ship class (player + enemy), Room class
    ├── combat.js     — CombatManager singleton, enemy AI
    ├── boss.js       — BossManager, 3-phase Mothership
    ├── map.js        — SectorMap node graph, EVENTS table
    ├── station.js    — Station shop, all buy actions
    ├── renderer.js   — Canvas draw pipeline, all screen layouts
    ├── ui.js         — Notifications, tooltips, crew panel, DOM station
    └── game.js       — Game state machine, main loop (entry point)
```

**Design principles:**
- Each file is a single IIFE module (no ES modules, works without a bundler).
- All state lives in dedicated manager singletons or class instances.
- No file exceeds ~600 lines.
- Zero external dependencies — runs from `file://` or any static server.

---

## File Map

| File | Responsibility | Key exports |
|---|---|---|
| `utils.js` | Shared helpers | `Utils.*`, `Utils.Timer`, `Utils.Interval` |
| `input.js` | Input abstraction | `Input.mouse`, `Input.isPressed()`, `Input.onCanvasClick()` |
| `audio.js` | SFX + music | `Audio.sfx.*`, `Audio.playMusic()` |
| `assets.js` | Sprite generation | `Assets.get()`, `Assets.draw()` |
| `particles.js` | VFX pool | `Particles.explosion()`, `Particles.fireParticles()` etc. |
| `animation.js` | Sprite animation | `Animation.crewIdle()`, `Animation.Tween` |
| `camera.js` | Viewport | `Camera.begin()`, `Camera.shake()` |
| `save.js` | Persistence | `Save.getRun()`, `Save.updateRun()`, `Save.getGraveyard()` |
| `crew.js` | Crew system | `CrewMember`, `makeStartingCrew()`, `makeEnemyCrew()` |
| `systems.js` | Ship systems | `ShipSystem`, `Reactor` |
| `weapons.js` | Weapons | `Weapon`, `Projectile`, `WEAPON_DEFS` |
| `oxygen.js` | O2 simulation | `OxygenManager`, `RoomOxygen` |
| `fire.js` | Fire | `FireManager`, `Fire` |
| `breach.js` | Hull breaches | `BreachManager`, `HullBreach` |
| `elevator.js` | Elevators | `ElevatorManager`, `ElevatorShaft` |
| `ship.js` | Ship entity | `Ship`, `Room`, `SHIP_LAYOUTS` |
| `combat.js` | Battle loop | `CombatManager` singleton |
| `boss.js` | Boss fight | `BossManager` singleton |
| `map.js` | Sector map | `SectorMap`, `MapNode`, `EVENTS` |
| `station.js` | Shop | `Station` class |
| `renderer.js` | Draw calls | `Renderer.*` |
| `ui.js` | Overlay UI | `UI.notify()`, `UI.openStation()` |
| `game.js` | Entry point | `Game.init()` |

---

## Game States & Flow

```
LOADING ──► MENU ──► MAP ──────────────────────────────────────────┐
                      │                                             │
                      ├── node: combat/elite ──► COMBAT ──► MAP    │
                      │                              │              │
                      │                              └── defeat ──► OUTCOME
                      │
                      ├── node: store ──────────────► STATION ──► MAP
                      │
                      ├── node: event ──────────────► EVENT ──► MAP
                      │
                      ├── node: boss ───────────────► COMBAT (3 phases) ──► MAP
                      │
                      └── node: exit ───────────────► next sector ──► MAP
                                                            or
                                                       sector 9 ──► OUTCOME (win)
```

**State transitions** are all handled in `game.js` `_setState()`.  
Each state transition clears canvas click listeners to prevent ghost clicks.

---

## Implemented Gameplay Mechanics

### Reactor & Power Management
- Reactor has a `level` (8–25), each level = 1 power unit.
- Systems request power; reactor distributes available bars.
- Player can click power bars (or call `Ship.setPower()`) to reallocate.
- Systems with `power = 0` are offline (no effect).
- Ion damage temporarily disables a system regardless of power.
- Reactor can be upgraded at stations.

### Shields
- Shields system converts every 2 power bars → 1 shield bar (max 2 bars at level 4).
- Each shield bar absorbs one projectile hit (missiles bypass).
- Shield bars recharge over time (7 seconds base, reduced by crew shield skill).
- Beam weapons and cannon-type projectiles bypass shields.
- Shield ring renders as glowing ellipse around ship.

### Weapons & Charging
- 8 weapon types: `laser_basic`, `laser_burst`, `laser_heavy`, `ion_basic`, `missile_basic`, `cannon_basic`, `flak_basic`, `beam_basic`.
- Each weapon has `chargeTime` (seconds), reduced by crew weapons skill.
- Weapons only charge when `power >= powerCost`.
- Crew in the weapons room reduce charge time by 10% per skill level.
- Player fires with number keys `[1]`–`[4]` or clicking fire buttons.
- Missiles consume ammo from run stock.

### Projectile System
- Each weapon type has a unique projectile visual (laser bolt, missile with wobble, cannon ball, ion ball).
- Beam weapons sweep across the enemy ship over time.
- Flak fires 3 shots with random spread.
- Hit detection: projectile reaches target position → `Ship.receiveHit()`.

### Evasion
- Engines system provides evasion % (5% per power bar).
- Crew piloting and engines skill add additional %.
- Maximum evasion capped at 60%.
- Each incoming hit rolls against evasion — on dodge, no damage.

### Hull Damage
- Hull is a numeric value (20–32 depending on ship/sector).
- Each projectile hit reduces hull by `def.hull_damage`.
- Hull at 0 triggers death animation (2.5 seconds of explosions, then `destroyed = true`).

### Hull Breaches
- Missiles and high-damage hits (≥2 dmg, 25% chance) open hull breaches.
- Each breach drains room O2 at 0.07/second.
- Crew with `breach` skill can seal breaches (repair speed × `breachSpeed()` multiplier).
- Sealing progress shown as arc on breach indicator.
- Sealed breaches are removed from manager.

### Fire System
- 25% chance per hull hit to start a fire in the hit room.
- Fire intensity: 1–3. Grows over time if not suppressed.
- Fires spread to adjacent rooms after 15 seconds (40% chance).
- Fires deal 0.5 system HP/second and 3 crew HP/second.
- Crew with `firefight` skill suppress fires (`firefightSpeed()` multiplier).
- Out fires are removed from manager.

### Oxygen System
- Every room tracks O2 level (0.0–1.0).
- O2 system (when powered) fills all rooms at 0.05/second.
- Breaches and vacuums drain O2.
- Crew in O2-empty rooms take 5 HP/second after a 3-second grace period.
- HUD shows average ship O2 as a labelled bar.
- Room overlay shows O2 % when below 95%.

### Crew System
- Crew are individual entities with world-space positions.
- Each crew member has 8 independent skills (see Skills section).
- Crew autonomously pathfind to assigned tasks.
- Tasks: `idle`, `move`, `repair`, `fire`, `breach`, `fight`, `operate`.
- Crew update their `roomId` based on which room they're standing in.
- Crew skills provide bonuses to their respective systems automatically.
- Dead crew trigger death animation, then are removed from roster.
- Dead player crew are added to the persistent Graveyard.

### Crew Skills (8 skills, max level 3)
| Skill | Effect |
|---|---|
| `piloting` | +5% evasion per level |
| `weapons` | -10% weapon charge time per level |
| `engines` | +5% evasion per level + crew move speed |
| `repair` | +50% repair speed per level |
| `firefight` | +50% fire suppression rate per level |
| `breach` | +50% breach seal speed per level |
| `shields` | -~0.15s shield recharge per level |
| `combat` | +30% crew melee damage per level |

- Each crew member earns XP by performing tasks (repair XP when repairing, etc.).
- Max 3 mastered skills per crew member.
- **Silver star**: 1 mastered skill. **Gold star**: 3 mastered skills.

### Multi-Floor Ships & Elevators
- Ships support 2–3 floors defined in `SHIP_LAYOUTS`.
- `ElevatorShaft` connects floors at fixed X positions.
- Crew use elevators to move between floors (pathfinding goes to shaft entry, then exits at target floor Y).
- Elevators can be damaged and repaired.
- Visual: shaft with rungs, coloured floor markers, animated cabin.

### Enemy AI
- Difficulty levels: `easy`, `normal`, `hard`, `boss`.
- AI cycles through targeting strategy: prefer shields room → weapons room → random.
- Fire delay scales with difficulty (0.5s boss, 1.5s easy).
- Enemy crew auto-repair damaged systems and fight fires.
- Enemy ships scale with sector (bonus hull per sector).

### Boss — The Mothership
- 3 phases, each with more HP and more weapons.
- Phase 1: `laser_burst` + `missile_basic`
- Phase 2: adds `ion_basic`
- Phase 3: adds `cannon_basic`
- Between phases: explosion effect, new ship instance spawned.
- Defeat gives 150–250 scrap reward.

### Sector Map
- 6-column node graph, 3 rows, seeded per sector.
- Node types: `combat`, `elite`, `store`, `event`, `nebula`, `empty`, `exit`, `boss`.
- Nodes unlock as player progresses (only adjacent unlocked nodes are reachable).
- 8 sectors total; sector 9 = game won.
- Map is procedurally regenerated with a new seed each sector.

### Random Events (8 types)
| Event | Choices |
|---|---|
| Derelict Ship | Board (scrap + risk) / Ignore |
| Distress Signal | Rescue (scrap + crew) / Pass by |
| Nebula Anomaly | Investigate (scrap + system risk) / Avoid |
| Rebel Patrol | Pay toll / Fight |
| Fuel Cache | Collect fuel |
| Supply Cache | Retrieve missiles |
| Field Medic | Upgrade medbay (costs scrap) / Decline |

### Station Shop (6 tabs)
| Tab | Contents |
|---|---|
| Repair | Hull HP, fuel, missiles |
| Weapons | 1–2 random weapons for sale |
| Modules | 1–2 system upgrade modules |
| Crew | 0–2 crew recruits with a starting skill |
| Reactor | Reactor upgrade (if in stock) |

- Stock is limited and randomly seeded per visit.
- Prices scale with item tier.
- Cannot buy if insufficient scrap or slot/capacity full.

### Scrap Economy
- Scrap is earned from combat (10–80 per fight, scales with sector).
- Scrap is spent at stations.
- **Cross-run scrap bank**: 50% of remaining scrap at run end is banked.
- Banked scrap persists across all runs (future: used for unlocks).

### Persistent Save
- Saved to `localStorage` as JSON.
- Persists: active run state, scrap bank, graveyard, unlocks, high scores, stats.
- Run state includes: sector, ship serialisation, crew, weapons, reactor level, fuel, missiles.
- Save written automatically on every state change.

### Graveyard
- All crew who die during any run are recorded.
- Stored: name, skills, sector they died in, cause of death.
- Last 50 entries kept.
- Viewable from main menu → GRAVEYARD.

---

## Systems Reference

| System | Max Power | Effect |
|---|---|---|
| Shields | 4 | 2 power = 1 shield bar; bars recharge over time |
| Weapons | 8 | Powers weapon charge; more = faster charge |
| Engines | 4 | 5% evasion per bar |
| Oxygen | 3 | Fills room O2 when powered |
| Medbay | 2 | Heals crew inside at 8 HP/s per power bar |
| Piloting | 1 | Required for base evasion; crew piloting skill adds % |
| Artillery | 4 | (Boss/elite variant) Heavy beam, bypasses shields |

---

## Weapons Reference

| Key | Label | Type | Damage | Power | Charge | Shots | Pierces Shields |
|---|---|---|---|---|---|---|---|
| `laser_basic` | Laser Mk I | laser | 1 | 1 | 5s | 1 | No |
| `laser_burst` | Burst Laser II | laser | 1×3 | 2 | 12s | 3 | Partial |
| `laser_heavy` | Heavy Laser | laser | 2 | 2 | 10s | 1 | No |
| `ion_basic` | Ion Cannon I | ion | 0 hull | 1 | 7s | 1 | Yes (ion effect) |
| `missile_basic` | Artemis | missile | 2 | 1 | 14s | 1 | **Yes** |
| `cannon_basic` | Hull Cannon | cannon | 3 | 3 | 18s | 1 | **Yes** |
| `flak_basic` | Flak I | flak | 1×3 random | 2 | 8s | 3 | No |
| `beam_basic` | Dual Beam | beam | 1/room | 2 | 20s | — | Partial |

---

## Crew & Skills

```
CrewMember
├── id, name, race, isPlayer
├── x, y (world position)
├── roomId (current room)
├── hp, maxHp
├── task: idle|move|repair|fire|breach|fight|operate
├── taskTarget: room id | Fire ref | CrewMember ref
├── skills: { [skillName]: { level: 0-3, xp: 0-N } }
├── anim: AnimationInstance (idle|walk|repair|fight|die)
└── _facing: 1 (right) | -1 (left)

Skill bonuses applied automatically:
- crew in weapons room → weaponCrewBonus() → weapon charge speed
- crew in engines room → engineBonus() → evasion
- crew in shields room → shieldBonus() → recharge speed
- crew in piloting room → pilotBonus() → evasion
- crew in medbay → medbay heals them
```

---

## Map & Sectors

```
SectorMap (seeded per sector)
│
├── nodes: MapNode[]
│   ├── id, type, x, y
│   ├── locked (true until adjacent node visited)
│   ├── visited
│   ├── next: string[] (ids of forward nodes)
│   └── prev: string[] (ids of backward nodes)
│
└── currentId: active node

Node types:
  combat  → spawn enemy_frigate, normal difficulty
  elite   → spawn enemy_frigate, hard difficulty + extra weapon
  store   → open Station shop
  event   → show random event popup
  nebula  → empty (cosmetic)
  empty   → nothing
  exit    → advance to next sector
  boss    → start 3-phase boss fight
```

---

## Station Shop

```
Station
├── type: general|military|science|outpost
├── name: procedural (e.g. "Alpha-Station")
├── sector: 1–8 (affects stock range)
│
└── stock
    ├── hullRepair: N HP available (3 scrap/HP)
    ├── fuel: N units (3 scrap each)
    ├── missiles: N (6 scrap each)
    ├── weapons[]: { key, def, sold }
    ├── modules[]: { key, def, sold }
    ├── crew[]: { name, skill, cost, member, sold }
    └── reactorUpgrade: bool
```

---

## Save System

```
localStorage key: moonwars_save_v1

SaveData {
  scrapBank: number           // persistent cross-run scrap
  unlocks: { ships[], crewRaces[] }
  graveyard: GraveEntry[]
  highScores: ScoreEntry[]
  stats: { runs, victories, deaths, scrapEarned, enemiesKilled }
  run: RunState | null        // null when not in run
}

RunState {
  sector, nodeIndex, visited[]
  ship: Ship.serialise()
  crew: CrewMember.serialise()[]
  scrap, fuel, missiles
  weapons[], systems[]
  reactorLevel
  seed
}
```

---

## Rendering Pipeline

**Draw order per frame:**

```
1. Renderer.clear()                     — fill #07080f
2. Renderer.drawBackground()            — parallax stars + moon
3. [state-specific]
   COMBAT:
     a. Renderer.drawCombatLayout()     — dividing line
     b. Ship.draw() × 2                — rooms → crew → fires → breaches
     c. CombatManager.draw()           — projectiles
     d. CombatManager.drawBeams()      — beam sweeps
     e. Particles.draw(layer=1)        — above-ship VFX
     f. Renderer.drawHUD()             — left panel, weapon bars, power
     g. _drawCombatControls()          — fire buttons, retreat
   MAP:
     a. Renderer.drawMapScreen()       — node graph
   EVENT:
     a. Renderer.drawEventPopup()      — choice modal
   STATION:
     a. Renderer.drawHUD()             — ship status while docked
4. UI.draw()                           — notifications, tooltips, crew panel
5. [pause overlay if _paused]
```

**Canvas resolution:** 1280×720, scaled via CSS to fit viewport. `image-rendering: pixelated` preserves pixel art look.

---

## Audio System

All audio is **procedurally synthesised** using Web Audio API — no audio files required.

```
Web Audio graph:
  OscillatorNode / BufferSourceNode (noise)
    → GainNode (envelope)
      → sfxGain or musicGain
        → masterGain
          → destination

SFX: weaponFire, weaponCharge, explosion, shieldHit, shieldRecharge,
     hullBreach, fireStart, repair, uiClick, uiHover, crewDie,
     scrapCollect, oxygenLow, powerUp, levelUp, bossWarning

Music: 4 procedural modes (explore, combat, station, boss)
       — 8-note melody loop with bass on every 4th beat
       — interval: 500ms normal, 300ms boss
```

---

## Asset Pipeline

All sprites generated programmatically at load time via offscreen `<canvas>` elements. No image files required.

| Sprite key | Description | Size |
|---|---|---|
| `ship_player` | Player frigate side view | ~192×144 |
| `ship_enemy` | Enemy interceptor | ~168×120 |
| `ship_boss` | Mothership cruiser | ~320×224 |
| `crew_player` | Blue crew member | 64×64 |
| `crew_enemy` | Red enemy crew | 64×64 |
| `icon_*` | System icons (6 types) | 48×48 |
| `room_*` | Room floor tiles (6 types) | 48×48 |
| `proj_laser` | Laser bolt | 24×8 |
| `proj_missile` | Missile | 24×8 |
| `proj_cannon` | Cannon ball | 24×8 |
| `particles` | Particle sprite sheet | 128×16 |
| `bg_stars` | Parallax star field | 1280×720 |
| `bg_moon` | Moon background art | 200×200 |
| `shield_ring` | Shield ellipse | 256×128 |

---

## Known Limitations / Next Steps

### Immediate fixes available
- Crew pathfinding is direct-line only (no obstacle avoidance around walls).
- Elevator usage by crew is not yet wired to pathfinding decision tree.
- `Animation.crewWalk()` generates new frames on each call (should cache by color).
- Enemy ship world position (820, 160) is hardcoded; should derive from canvas width.

### Planned next features (from spec)
1. **Sprite polish** — More detailed pixel-art ships with proper side-view profiles.
2. **Crew boarding** — Enemy crew teleport to player ship; fight resolved in rooms.
3. **Nebula effects** — Reduced visibility, sensors offline, O2 faster drain.
4. **Unlock system** — Spend banked scrap to unlock ships and crew races.
5. **Settings screen** — Volume sliders, resolution, keybindings.
6. **High score table** — Rendered on main menu.
7. **Artillery beam** — Player-side heavy weapon animation.
8. **Drone system** — Optional combat module.
9. **More ship layouts** — Cruiser, stealth, drone-carrier.
10. **Animated crew portraits** — Shown in crew panel.

### Architecture notes for future contributors
- All game-world units are canvas pixels (no separate world/screen scale needed as long as canvas = 1280×720).
- `Input.onCanvasClick()` listeners accumulate each frame during draw; cleared at each `_setState()`. Do not register persistent listeners in draw functions — use `Input.onCanvasClick(..., cb, once=true)` or clear+re-register.
- `Save.updateRun()` calls `localStorage.setItem()` synchronously — do not call inside tight loops.
- Adding a new system type: add entry to `SYSTEM_DEFS`, add `room_typename` sprite in `assets.js`, add room to desired layout in `SHIP_LAYOUTS`.
- Adding a new weapon: add entry to `WEAPON_DEFS` in `weapons.js`. It automatically appears in station stock and enemy weapon pool.
