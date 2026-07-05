# MOON WARS — PROJECT.md

> Tactical space survival game inspired by FTL. Side-view ships.
> Browser-only: HTML5 + CSS + JS (ES6) + Canvas2D. No engines, no frameworks.
> Live: https://czjmaster.github.io/moonwars/
> Repo: https://github.com/czjmaster/moonwars (branch: master)

**Workflow:** Claude edits files → user downloads → copies to `C:\MoonWars\` →
`git add . && git commit -m "..." && git push`. GitHub Pages deploys automatically.
If Pages deploy hangs ("Deployment failed, try again later" / stuck Queued):
Settings → Pages → Branch: None → Save → wait 30s → Branch: master → Save.
Always hard-refresh (Ctrl+Shift+R) after deploy.

---

## File map

```
index.html          script load order = dependency order (no bundler, IIFE modules)
css/ui.css          tokens, loading screen · hud.css tooltips/notifs · station.css shop
js/
  utils.js       math, Timer, Interval, DOM helpers
  input.js       KB+mouse; PENDING BUFFERS: events write _pendingPress etc.,
                 beginFrame() transfers → flags survive the frame (critical fix)
  audio.js       WebAudio procedural SFX + 4 music modes (no audio files)
  assets.js      procedural pixel sprites (no image files)
  particles.js   pooled (600 cap)
  animation.js   cached frames; crewByColor(state,color) color-keyed cache
                 (NEVER generate frames outside cache — caused GPU crash/black screen)
  camera.js      pan/zoom/shake
  save.js        localStorage: run, scrapBank, graveyard, unlocks, stats
  crew.js        CrewMember, corporations, waypoints, elevator riding, auto-tasks
  systems.js     ShipSystem (FTL damage model), Reactor
  weapons.js     WEAPON_DEFS, Weapon (targetRoom, autoFire), Projectile
  oxygen.js      per-room O2, passive drain, door equalisation
  fire.js        spread via OPEN doors only, needs O2, eats hull 1/8s
  breach.js      breaches drain O2, crew seal
  elevator.js    shafts; cabin CARRIES passenger (board/release)
  ship.js        Ship, Room, Door (+airlocks), layouts, damage resolution
  combat.js      CombatManager singleton, enemy AI
  boss.js        BossManager: 3-phase Mothership, systems auto-scaled to weapons
  map.js         SectorMap: 3 sectors, connectivity fix, balance pass
  station.js     shop: repair/fuel/missiles/weapons/modules/crew/reactor
  renderer.js    FTL-style HUD, enemy module panel, _powerClickZones
  ui.js          notifications, skill panel (left), station DOM, graveyard
  game.js        state machine: menu|map|combat|event|station|outcome
```

## Architecture rules (learned the hard way)

1. **Input**: game code reads `Input.mouse.leftPressed` / `isPressed()` inside
   `_update`. Events buffer to `_pending*`; `beginFrame()` promotes them.
   Never rely on event-time flags directly (frame-order bug).
2. **Clicks**: NO `onCanvasClick` listeners registered in draw loops.
   Renderer pushes rects into `_powerClickZones` (cleared once at top of
   `drawHUD`); `game.js _handlePowerBarClick()` consumes them via pointInRect.
   Zone keys: `{system,pip}`, `{weapon}`, `{weaponAuto}`, `{systemToggle}`, `{crewIndex}`.
3. **Animations**: all frames pre-generated & cached (Animation.init +
   crewByColor cache). Creating canvases per-frame leaks GPU memory → PC crash.
4. **No shadowBlur in per-frame draws** (shields, map nodes, HUD) — use layered
   translucent strokes instead.
5. Ships have NO sprite: rooms + hull plate + engine glow = the ship.
   `ship.roomBounds()` is the visual body; shield rings wrap it.

## Gameplay state (all implemented & tested)

### Power / modules (FTL model)
- Module level = power slots (max 8; shields max 4, 2 power per shield layer).
- `desiredPower` = intent; per-frame flow: `power = min(desired, workingLevels, reactor budget)`
  → repairs auto-restore power (both ships). Player pip clicks set desired.
- Hit breaks 1 level (red square top of pip stack); excess power returns to reactor.
- Crew repairs level-by-level (progress ring); idle crew auto-repair own room.
- Icon click toggles module ON/OFF (remembers _prefPower).
- Terra cyborg in room: +1 effective power (capped at maxPower).
- `sys.crew` synced every frame in Ship.update (bonuses depend on it).

### Evasion
`piloting.effectivePower*3% + engines.effectivePower*2% + pilot skill`,
**0% if no living crew in cockpit**. Cap 60%.

### Oxygen
Refill 0.03/s per powered O2 level MINUS passive drain 0.014/s everywhere
(O2 off ⇒ ship suffocates). Breach drain, vacuum drain, open doors equalise
between rooms. Suffocation: 5 hp/s after 3 s at zero.

### Fire
Spreads only through OPEN doors, never between floors. Needs O2 (<8% ⇒ dies).
Damages system (breaks level per 8 accumulated), crew 3 hp/s,
**hull −1 every 8 s while burning**. Venting via airlock = FTL tactic.

### Doors & airlocks
Interior doors: auto / locked-open / locked-closed (click cycles).
Airlocks on outer wall of edge rooms per floor; open = room venting (red glow).
Closed doors block fire and O2 flow.

### Movement / elevators
Crew walk horizontally on floor lines; floor change ONLY via elevator.
Cabin owns the ride: crew summons → boards (`shaft.board`) → shaft moves
crew with cabin → releases (`_elevatorArrived`). One passenger at a time.
Shaft choice cost = walk + cabin-wait distance. Shaft = vertical module,
doors both sides at each floor, square animated cabin.

### Weapons / combat
- Player: 2 slots, starts with 1 laser. Weapons draw from weapons-system
  effectivePower ⇒ damaged weapons module stops guns (both ships).
- Targeting: click weapon (or key 1-4) → click enemy room; **room remembered**,
  next shots hit same module. AUTO ON/OFF button per weapon = fire on charge.
- Hits land in room containing projectile impact point (not random).
- Crew in hit room take 10-25×dmg damage.
- Missiles/cannon bypass shields; ion disables; beam sweeps.
- Victory: screen stays, crew repair, JUMP [SPACE] button when ready.
- Retreat: needs working engines AND manned cockpit; **impossible vs boss**.

### Crew & corporations
8 skills, max level 3, master ≤3 (silver=1★, gold=3★). XP sources:
repair, breach, firefight (during), weapons (per shot, crew in weapons room),
piloting+engines (per dodge), shields (per recharge), combat (+15 per win).
Skill panel (left, click crew row) shows pips + XP bars.
Corporations (player crew, color-coded, names always shown above sprite):
- Aquarius #4db8ff — 2× shields+repair XP
- Pegasus  #9fdcff — 2× piloting XP
- Terra    #ff9a40 — 2× engines XP, cyborg +1 module power
- Phoenix  #ff5544 — 2× weapons/combat/firefight XP
Home stations: priority cockpit→engines→shields→weapons (corp-matched);
crew return home after tasks; player click reassigns home. Enemy AI sends
ONE repairer (closest, skill tie-break).

### Map (3 sectors)
6 cols × 3 rows, seeded. Sector 1-2 end in EXITs; sector 3 ends in ONE boss
node (middle). Connectivity pass removes dead ends. ≥3 fights, ≤2 stores
per sector. Node types: combat/elite/store/event/nebula/empty/exit/boss.
Normal enemies: NO shields. Elite: shields (s1: 1 layer, s2+: 2), extra gun,
more hull. Sector scaling on hull/reactor/weapons. 8 random events.

### Boss — Mothership (sector 3)
3 phases (24/28/32 hull, growing loadout). Systems auto-scaled: weapons level
≥ sum of weapon power costs (else it can't shoot — was a real bug), shields 4,
reactor 16+2/phase. Defeat = run victory → scrap bank.

### Economy / persistence
Scrap from wins; station stock limited & seeded; 50% remaining scrap banked
cross-run on victory; graveyard records fallen crew (fixed pointer-events bug:
overlays inside #ui-overlay need `pointer-events:auto`).

## Known TODO / next steps
- Boarding (enemy crew teleport aboard, room combat) — TASK.FIGHT exists.
- Save/continue mid-run round-trip test (serialise exists; corp fields NOT yet
  serialised — add race/homeRoomId to CrewMember.serialise!).
- Station buy flows retest after refactors.
- Balance pass; more ship layouts; unlocks spend scrapBank; settings screen.
