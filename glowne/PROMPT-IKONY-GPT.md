# MOON WARS — PROMPT DLA GPT: KOMPLET IKON

> Wygenerowane z KODU 2026-09-08 (po update66), nie z pamięci. Każda pozycja
> niżej ma swojego czytelnika w grze.
>
> **Jak używać:** wklej sekcję **A** raz, na początku rozmowy. Potem wklejaj
> sekcje **B1–B7** po jednej na wiadomość. Nie proś o wszystko naraz — arkusz
> z 60 ikonami wychodzi rozmyty i nie da się go pociąć.
>
> **Format, który MUSI wrócić:** patrz sekcja C. Gra nie ma dziś ani jednego
> pliku graficznego, więc nazwy plików muszą się zgadzać co do znaku.

---

## A. PROMPT USTAWIAJĄCY STYL — WKLEIĆ RAZ

```
You are drawing an icon set for MOON WARS, a 2D sci-fi roguelike in the spirit
of FTL. The game is pure Canvas2D at 1280x720 and currently draws every icon
procedurally with vector primitives — you are replacing that, so everything you
make must read at very small sizes.

HARD CONSTRAINTS
- Flat vector shapes only. No gradients, no photographic texture, no 3D
  renders, no bevels, no drop shadows, no lens flare, no outlines that vary in
  width.
- Every icon is a SILHOUETTE first: it must still be identifiable when filled
  with one flat colour at 16x16 pixels.
- Line weight is uniform across the whole set. Assume a 2px stroke on a 48px
  icon, scaled proportionally.
- Icons are drawn WHITE (#FFFFFF) on a fully TRANSPARENT background. The game
  tints them at runtime — do not bake in colour, do not draw a background
  plate, do not add a circular badge behind the glyph.
- Centre each glyph in its cell with ~8% padding on every side, so nothing
  touches the edge.
- No text, no letters, no numbers anywhere in any icon. This game runs in
  English but the icons must carry meaning without words.
- No annotations, no labels under the icons, no grid lines, no rulers, no
  design-tool chrome in the output image.

ART DIRECTION — "lunar"
The game's look is regolith and hard vacuum: greyscale base, and exactly four
accent colours that are RESERVED FOR STATE (amber = running low, red = loss or
threat, green = ready or good, pale blue = interactive). That is why your icons
must be colourless: anything with baked-in colour would lie about state.

Shapes should feel MACHINED and utilitarian — straight cuts, honest angles,
simple geometry. Think engraved warning plates on industrial equipment, not
glossy app icons and not hand-drawn fantasy.

CONSISTENCY IS THE WHOLE JOB
These icons sit next to each other in rows on a HUD. A set where one icon is
detailed and its neighbour is simple reads as broken. Same visual weight, same
level of detail, same stroke, same optical size across every icon in the set.

Acknowledge and wait — I will send the icon lists one group at a time.
```

---

## B. GRUPY IKON

Każdą poprzedź zdaniem: `Same art direction as before. Now draw this sheet:`

### B1. MODUŁY STATKU — 11 ikon (NAJWAŻNIEJSZE)

> To jest grupa, po którą przyszliśmy. Dziś **pięć z jedenastu modułów pożycza
> cudzą ikonę**: reaktor i cloak używają ikony silnika, cela i repair bay
> używają ikony medbaya, artyleria używa ikony działa. Gracz patrzy na dwa
> różne pokoje z tym samym obrazkiem.

```
One sheet, 11 icons in a grid, each in its own square cell, same size and
weight. These mark rooms in a ship cross-section and appear again in a
horizontal power bar, so each must be distinct from all ten others in
SILHOUETTE alone — not by detail.

1  REACTOR — the ship's power plant. Everything else draws from it.
2  SHIELDS — a projected energy bubble around the hull.
3  WEAPONS — the gun bay that powers the ship's guns.
4  ENGINES — thrust and evasion.
5  OXYGEN — life support, breathable air.
6  CLOAK — the ship vanishes from sensors for a few seconds.
7  REPAIR BAY — a nanobot swarm that slowly mends damaged modules.
8  BRIG — a holding cell for prisoners. Lose its power and they work the lock.
9  MEDBAY — heals wounded crew lying in it.
10 COCKPIT — piloting station, steering and evasion.
11 ARTILLERY — a heavy fixed gun, distinct from the weapons bay above.

Watch these three pairs especially — they are the ones the game currently
confuses, and if any pair reads alike at 16px the sheet has failed:
- REACTOR vs ENGINES (both about power)
- MEDBAY vs REPAIR BAY (both about mending)
- MEDBAY vs BRIG (a cell is not a clinic)
- WEAPONS vs ARTILLERY (a bay of guns vs one big gun)
```

### B2. ODCZYTY STANU — 13 ikon

> Osiem z nich już istnieje jako kod w `STAT_ICONS`; reszta to braki, które
> wyszły przy ostatnich paczkach.

```
One sheet, 13 icons. These sit inline next to numbers on a HUD strip, at about
11 pixels tall. Extreme legibility at small size matters more than character.

1  HULL — the ship's structural integrity.
2  POWER — one unit of reactor output.
3  SHIELD — one shield layer.
4  DAMAGE — weapon damage output.
5  SHOTS — number of projectiles a gun fires per volley.
6  CHARGE — a weapon's reload timer.
7  AMMO — a missile warhead.
8  ORE — Helium-3, a rough mined crystal. NOT a canister and NOT a crate:
   it must read as something dug up, not something poured.
9  FUEL — He2, the fuel the drive burns. A pressurised cell or canister.
10 FOOD — a sealed ration. Must not read as a medical item.
11 CREDITS — the game's money (called CC).
12 CREW — one crew member, as a counter rather than a portrait.
13 KARMA — the commander's reputation. Abstract: a balance or a weighed
   scale, not a face and not a halo.
```

### B3. UMIEJĘTNOŚCI ZAŁOGI — 8 ikon

```
One sheet, 8 icons. These appear as tiny pips beside a crew member's name in a
roster, and again on a hiring card. They must be distinguishable from each
other at 10 pixels.

1  PILOTING — steering the ship, evasion.
2  WEAPONS — manning a gun.
3  ENGINES — running the drive.
4  REPAIR — mending a broken module.
5  FIREFIGHT — putting out a fire aboard.
6  BREACH REPAIR — sealing a hole in the hull to space.
7  SHIELDS — running the shield generator.
8  COMBAT — hand-to-hand fighting aboard a ship.

Careful: PILOTING vs ENGINES, and REPAIR vs BREACH REPAIR, are the two pairs a
player will confuse. Make them read differently in silhouette.
```

### B4. GLIFY KORPORACJI — 5 znaków

> To jest rozwiązanie problemu z briefu: korporacje mają dziś tylko kolory, a
> w szarej palecie kolory się zlewają. Znak działa też dla daltonistów.

```
One sheet, 5 marks. These are FACTION GLYPHS stamped on a crew member's icon —
simpler than the icons above, closer to a cattle brand or a stencil than a
logo. Each must survive being drawn 8 pixels wide in the corner of a portrait.

1  AQUARIUS — a deep-water salvage corporation. Patient, methodical.
2  PEGASUS  — a courier and transport house. Fast, light.
3  TERRA    — heavy industry from Earth. Crew are half machine; blunt, solid.
4  PHOENIX  — a military contractor. Aggressive, disciplined.
5  VOID SPIDER — not a corporation. A hostile alien thing that lays eggs in
   your hold. Should look WRONG next to the other four — organic and
   asymmetric where they are geometric.

Use only: straight lines, circles, simple angles. No detail that dies below
16px. Do not use letters or monograms.
```

### B5. ROZKAZY SPECJALNE DOWÓDCY — 8 ikon

> Osiem glifów w rzędzie bez podpisów to osiem zagadek — dlatego te muszą być
> najczytelniejsze z całego zestawu.

```
One sheet, 8 icons. These are the commander's one-per-battle special orders and
sit in a single row of small square buttons, unlabelled, about 26px each. A
spent order is drawn greyed AND struck through, so the glyph must still read
under a diagonal line.

1  EVASIVE PATTERN  — a burst of dodging; incoming fire misses.
2  FLANK SPEED      — everything into the engines for a short sprint.
3  FULL SALVO       — every gun fires at once.
4  EMERGENCY BUBBLE — an instant shield layer, once.
5  DAMAGE CONTROL   — the crew repair everything faster for a while.
6  FIRE SUPPRESSION — every fire aboard is put out.
7  HULL SEAL        — every breach to space is closed.
8  BATTLE FURY      — boarding crew fight harder.
```

### B6. ŁADUNEK — 14 ikon

> Ładownia to siatka; przedmiot zajmuje 1×1 albo 2×1 pola i musi być
> rozpoznawalny w kratce.

```
One sheet, 14 icons for cargo containers. Each is a THING IN A HOLD, so they
should read as physical objects — boxes, cells, racks — rather than symbols.
Note the two aspect ratios: most are square (1x1 cell), three are twice as wide
as tall (2x1 cells) and should be drawn in a wide cell.

SQUARE (1x1):
1  MISSILE RACK    — a rack of warheads.
2  FUEL CELL       — a small pressurised He2 cell.
3  ORE             — raw Helium-3, the mined crystal from sheet B2.
4  MEDICAL SUPPLIES— doses of medicine.
5  RATION PACK     — the standard sealed meal box.
6  PROTEIN PASTE   — cheap reclaimed protein in a tube. Half a meal.
7  GREEN RATION    — vat-grown, no animal in it. Must read as PLANT-based
   without using colour, since these icons are colourless.
8  SURVEY PROBE    — a one-shot mapping drone.
9  DATA CORE       — stored information, worth money.
10 PLATING         — spare hull plate.
11 CONTRABAND      — smuggled goods. Should look like something you would
   rather a military port did not open.
12 SPIDER EGG      — an alien egg. Organic, wrong, matching B4's spider.

WIDE (2x1):
13 FIELD MEAL      — a proper hot meal tray, twice the size of a ration.
14 BODY BAG        — a sealed bag with a person in it. Sombre and plain.
   It must not look like a weapon crate or a sack of goods — a player
   glances at his hold and has to feel what that one is.

Also draw a SMALL (1x1) variant of the body bag for a dead ship's cat.
```

### B7. WĘZŁY MAPY — 8 ikon

```
One sheet, 8 icons. These sit inside small circles on a sector map and are seen
at roughly 16px. Simplest shapes of the whole job.

1  ENEMY      — an ordinary fight.
2  WANTED     — a fight against a pirate with a price on his head. Must be
   instantly separable from ENEMY at a glance across the whole map: this is
   the node a player crosses a sector to reach.
3  STATION    — a port where you trade and repair.
4  EVENT      — an unknown encounter, a question.
5  NEBULA     — a cloud that cuts power on both ships.
6  EMPTY      — nothing here.
7  EXIT       — the way out of the sector.
8  BOSS       — the contract's final fight.
```

---

## C. CZEGO POTRZEBUJEMY Z POWROTEM

Poproś na końcu każdej grupy:

```
Now output the same sheet a second time as a TRANSPARENT PNG sprite sheet:
- one row, icons in the exact order listed above
- each icon in a 64x64 cell, no padding between cells, no background
- white glyphs on full transparency
- no labels, no numbering, no separators drawn into the image
Also give me the pixel x-offset of each icon in that row.
```

### C.1. Nazwy plików, których oczekuje gra

Ikony modułów **muszą** nazywać się dokładnie tak — te nazwy są w `SYSTEM_DEFS`:

```
icon_reactor   icon_shields   icon_weapons   icon_engines   icon_oxygen
icon_cloaking  icon_autorepair  icon_brig    icon_medbay    icon_piloting
icon_artillery
```

Reszta grup: `stat_*`, `skill_*`, `corp_*`, `order_*`, `cargo_*`, `node_*`.

### C.2. UWAGA TECHNICZNA — po naszej stronie

**Gra nie ma dziś ANI JEDNEGO pliku graficznego.** Wszystko rysuje `assets.js`
proceduralnie. Zanim wejdzie pierwszy PNG, trzeba dopisać **loader z
fallbackiem**: brakujący albo niewczytany plik musi wracać do dotychczasowego
rysowanego sprite'a, a nie wywalać gry. Inaczej jeden zły plik = czarny ekran.

---

## D. CZEGO **NIE** ZAMAWIAMY TYM PROMPTEM

* **Kafle podłóg 48×48** — inna robota (muszą się bezszwowo kafelkować),
  osobna rozmowa.
* **Statki i sylwetki załogi** — rysowane proceduralnie i animowane; podmiana
  na obrazki to zmiana silnika rysowania, nie ikon.
* **Ekrany UI** — gotowe prompty na to są w `brief-graficzny-ui.md` §6.
