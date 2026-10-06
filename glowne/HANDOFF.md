# MOON WARS — HANDOFF (przekazanie kontekstu między czatami)
> Dla asystenta AI: przeczytaj CAŁY ten plik przed pierwszą zmianą w kodzie.
> Ostatnia aktualizacja: 2026-08-23 (po moonwars-update37).

## 1. WORKFLOW (nie zmieniać!)
- Użytkownik (czjmaster) wgrywa **MoonWars.rar** z aktualnym stanem repo. To JEDYNE źródło kodu
  (GitHub nie daje się fetchować). Folder `glowne/` w RAR ignorować — liczy się `MoonWars/js/`.
- RAR-5 rozpakować: `apt-get install -y unrar && unrar x plik.rar` działało bez
  problemu w tym środowisku (update33) — spróbować tego NAJPIERW, zanim
  sięgnie się po libarchive/ctypes jako obejście.
- Asystent edytuje pliki, pakuje TYLKO ZMIENIONE do `moonwars-updateN.zip` w outputs.
- Użytkownik rozpakowuje do `C:\MoonWars\` i wykonuje: `git add . && git commit -m "..." && git push`
  (początkujący w git — zawsze podawać pełne 3 komendy; commit bez add = pusty push).
- Po pushu: 1–2 min na GitHub Pages, Ctrl+Shift+R, **NOWY RUN** po każdej zmianie formatu save.
- Odpowiedzi po polsku; podsumowanie zmian po każdej partii; "dodaj coś od siebie" = mile widziany
  1 mały bonus w temacie partii.

## 2. ARCHITEKTURA
- Czysty JS (bez modułów!): klasyczne `<script>` w index.html, top-level `const/class` są globalne.
  Kolejność skryptów ma znaczenie (utils→…→map→…→game na końcu).
- Canvas 2D 1280×720. Stany gry: menu / **base** / map / combat / event / station / outcome.
- Pliki: utils, assets, audio, input, camera, particles, animation, oxygen, fire, breach, elevator,
  systems, weapons, crew, ship, map, save, station, **base, basescreen**, boss, combat,
  renderer, ui, game.
- Statki: SHIP_LAYOUTS w ship.js (scout=darmowy start BEZ osłon, hauler=kupny 8 pokoi,
  frigate=kupny 3 pokłady, enemy_frigate/gunship/raider, boss_station).
  Katalog kupna + ceny + odsprzedaż 30%: SHIP_CATALOG / SHIP_RESALE w base.js.
  Współrzędne pokoi są PO dodaniu worldX/worldY w konstruktorze.
- Systemy budowane PER POKÓJ (wiele modułów 'weapons' = wiele niezależnych systemów).
  Energia: kliknięcia w pasek używają INDEKSU systemu (setPowerAt), nie typu.

## 3. KLUCZOWE MECHANIKI (stan aktualny — NIE reimplementować!)
- **ŁADOWNIA KADŁUBA MA JEDNO ŹRÓDŁO (update46)**: `layout.cargoCols`.
  `CARGO RETROFIT`, `holdLvl` i `holdBonus()` SKASOWANE — nie dodawać ich
  z powrotem. Ekran pakowania i konstruktor `Ship` muszą podawać tę samą
  liczbę; sekcja 41 tego pilnuje.
- **KOT (update45)**: `isPet`, wchodzi w `isBeast`, jest po NASZEJ stronie
  (`isPlayer`). `Ship.petTick()` prowadzi go po pięciu priorytetach; przy
  rannym spowalnia `_bleedT` przez `CAT_TUNING.VIGIL_FACTOR`. Liczby siedzą
  w `CAT_DEFS` i `CAT_TUNING` w `crew.js` — jedna tabela, jak `XP_RATES`.
  **`crewOperating()` odfiltrowuje bestie** — bez tego kot obsadzał działo.
  Kot NIGDY nie trafia do koszar: bankowanie załogi przy dokowaniu musi
  filtrować `!c.isBeast`.
- **XP Z OSŁON PŁACI SIĘ ZA ZESTRZELONE WARSTWY, NIE ZA DOŁADOWANIA
  (update44)**: `hitShield()` zapisuje `_shieldDebt`, `_updateShields` wypłaca
  wyłącznie z niego, `prechargeShields()` zeruje go na start walki. Bez tego
  odbieranie modułowi mocy i oddawanie jej z powrotem było darmową farmą XP
  między walkami. Nagroda ma wisieć na PRZYCZYNIE, nie na skutku.
- **MESA I ZAGRODY TO ZWYKŁE BUDYNKI (update44)**: mesa stoi na poziomie I od
  początku (1 koja), zagrody dla zwierząt są 2 od początku, a rozbudowa obu
  idzie przez `Base.buyUpgrade('mess'|'pets')` — TĘ SAMĄ drabinę co magazyn
  i koszary. Zagrody NIE są kojami: kot konkurujący z piątym strzelcem
  o łóżko nigdy by nie poleciał.
- **PREMIĘ MODUŁU DAJE OPERATOR PRZY KONSOLI (update43)**: `Ship.consoleOperator(roomId)`
  = kto stoi na slocie 0; `null` dla pustego i dla SPORNEGO modułu. Działa,
  tarcze, pilotaż i silniki liczą JEDNEGO człowieka, nie sumę po pokoju —
  i ten sam człowiek dostaje XP. Cap 75% w `weapons.js:370` **zostaje**
  (bez niego wychodzi `dt / 0`), ale nie jest już tym, co ogranicza.
- **STAWKI XP TO JEDNA TABELA — `XP_RATES` w `crew.js` (update43)**. Nigdy nie
  wpisywać liczby w wywołanie `addXP` — sekcja 137 przeszukuje `js/` i to
  odrzuca. **`addXP()` zwraca KWOTĘ PRZYZNANĄ** (po mnożniku korporacji,
  zero dla mistrza), bo to jest liczba, którą kopiuje kapitan.
- **KAPITAN (update43, `commander.js`)**: NIE jest jednostką na pokładzie — brak
  HP, ruchu, konsoli i rozkazów. Rekord w `Base.commanders()`, na wyprawie ten
  SAM obiekt siedzi w `_commander` w game.js (nigdy kopia). Poziomy 1–8, kopiuje
  XP swoich ludzi 1:1, premie tylko dla własnej korporacji. Ginie w `_onLose`.
  Promocja w mesie ZABIERA człowieka z koszar — bez kopii, bez cofnięcia.
- **BAZA (meta-progresja, update20)**: gra kręci się wokół bazy — z niej startuje KONTRAKT.
  `Base.launch()` wyprowadza statek/załogę/zapasy Z bazy, `Base.returnFromRun()` (przez
  `_dockAtBase`) wkłada je z powrotem po ukończeniu. Przegrana = nic nie wraca (nic nie kasujemy!).
  Limity: magazyn 20/linię, koszary 5 bunków, hangar 2 miejsca — do rozbudowy za CC.
  ZBROJOWNIA: zapasowe działa (tylko z ładowni!) — montaż/demontaż/sprzedaż przed startem.
  Kontrakty: `courier` (1 sektor, **boss: null**), `patrol` (2 sektory, boss elite)
  i `mothership` (3 sektory, boss station).
- **Reaktor**: 1 moc/poziom, per-hull max (gracz 16, frigate 12, gunship 14, boss 20).
  **Cenę zna WYŁĄCZNIE sprzedawca**: `Station.reactorCost(ship)` → `REACTOR_PRICE` (wykładnicze,
  od update30). `Reactor.upgradeCost()` skasowane w update34 — była to druga, liniowa cena,
  z której rysował się przycisk, podczas gdy kasa liczyła inaczej (patrz §5-0 pkt 11).
  NIE dodawać ceny z powrotem do sprzętu.
  Gracz startuje lvl 8. Wróg: reaktor lvl = suma maxPower modułów (capped). Kara nebuli: reactor.penalty.
- **Załoga chodzi po LINII CHODZENIA** (`floorWalkY`); podniesione jest WYŁĄCZNIE
  miejsce przy konsoli i tylko jako OSTATNI waypoint trasy. Nigdy nie wkładać
  podniesionego Y do odcinka podróży — człowiek będzie szybował nad pokładem.
- **Wrak ma zawsze `totalPower === 1`** i zasila nim życie podtrzymujące
  (`makeDerelict`). Abordażyści NIE sabotują wraku. Jaja mają `revealed=false`
  i pokazują się dopiero, gdy ktoś wejdzie do pokoju. **1–4 jaja
  (`MAX_DERELICT_NESTS`), po JEDNYM na pokój** (tasowanie w `populateDerelict`);
  ładownia otwiera się dopiero, gdy zginą WSZYSTKIE (śpiące jajo liczy się jako
  żywy wróg).
- **Drzwi NALEŻĄ do kadłuba** (update36): otwierają się dla załogi tego statku,
  a intruz musi je ZHAKOWAĆ (`Door.hackBy(strona, dt)`, 2.5 s, raz na walkę na
  stronę; `Ship.onBattleStart()` resetuje). Intruz musi zhakować także drzwi
  zostawione OTWARTE — patrz `_doorBlocking(..., includeOpen)`.
- **JEDNA SIATKA KADŁUBOWA (update41)**: `HULL_GRID` w `ship.js` to JEDYNE
  źródło wymiarów — moduł 80×72, skok pokładu 80, szyb 28. Layouty deklarują
  `{col, row}`, `buildHull()` wylicza piksele i przystanki wind.
  **Nigdy nie wpisywać pikseli do layoutu** — tak powstały trzy rozmiary modułu.
  Kafle zewnętrzne: `Ship.engineSlots()` (jeden na pokład) i `Ship.prowSlots()`
  (`slice` = solo/top/mid/bot wg liczby pokładów). Stacja (`isStation`) nie ma żadnych.
- **ZWŁOKI ZOSTAJĄ NA POKŁADZIE (update40)**: `Ship.update` usuwa z rostera
  TYLKO zwierzęta (`c.dead && c.isBeast`) i wyrzuconych przez śluzę
  (`_updateBodies`). Ciało leży, gnije po walce (`markCombatStart`) i zaraża
  pokój. Wszystko, co liczy ludzi, filtruje `!c.dead` — nie dodawać z powrotem
  globalnego `filter(c => !c.dead)`.
- **`Utils.randIn(min, max)` JEST WŁĄCZNY, `randInt` NIE (update40)**: gdziekolwiek
  DANE deklarują zakres domknięty (`crewDamage: [10,25]`, `scrap: [5,15]`,
  komentarz „1-3") — używać `randIn`. `randInt(1,2)` to zawsze 1.
- **DŹWIĘK (update40)**: `Audio.sfx.*` jest wołany przez `?.()`, więc literówka
  w nazwie = cisza bez błędu. Sekcja testów 112 sprawdza KAŻDĄ nazwę w `js/`.
  Hover gra przez `Audio.hoverCue(id)` (wyzwalanie zboczem), nie przez `uiHover`
  wprost. Poziomy głośności: `Save.getSetting/setSetting` ↔ `Audio.applySettings()`
  (wołane PO `Save.load()`), ekran `STATE === 'options'`.
- **He2 I RAKIETY TO ŁADUNEK (update39)**: `ship.cargo.countOf('fuel')` /
  `countOf('missiles')` to JEDYNA prawda. `run.fuel` i `run.missiles` są
  LUSTRAMI (`_syncFuel`/`_syncAmmo` co klatkę) dla HUD-u i starych save'ów.
  Skok = `takeStack('fuel', 1)`; **pusta ładownia = brak skoku**, licznik nie
  ratuje. Wypłaty przez `_addFuel`/`_addMissiles` (meldują, ile się nie
  zmieściło). `Base.launch()` **ignoruje** argument `fuel` — nic nie wychodzi
  z bazy jako luźne jednostki. Nie dodawać z powrotem „zbiornika".
- **MGŁA NA MAPIE (update39)**: `SectorMap.visibilityOf(node)` →
  `known` / `horizon` / `dark`. Klikalne jest tylko `known`; krawędź rysuje się
  tylko gdy oba końce są ≥ `horizon`. `SURVEY PROBE` (`kind: 'scan'`) z ładowni
  ustawia `revealed` i jest zapisywane w `mapProgress.revealed`.
- **SZCZURY (update39)**: losowane NA SKOK z zapełnienia ładowni (próg 50%,
  max 22%) + `tag: 'food'` (+9%/szt., cap 27%, ale samo jedzenie nie wystarczy).
  `Ship.verminTick` zwiera moduł przez `sys.ionHit()` **tylko w walce**.
  Atak na załogę dzieje się sam — szczur to wroga załoga w `ship.crew`.
  **`CrewMember.isBeast` (pająk ‖ robactwo) to filtr „to nie człowiek"** —
  używać go wszędzie, gdzie pytamy „kto może obsadzić / nieść / gasić".
- **MIEJSCA W MODULE (update38)**: 3 sloty — 0 konsola (podniesiona), 1 lewa,
  2 prawa. Rozdziela je WYŁĄCZNIE `ship.js`: `takenStationSlots` / `freeStationSlot`
  / `allocStationSlots` (kilku naraz — po jednym wolnym na głowę, po kolei).
  Kto IDZIE do slotu, już go posiada (`CrewMember.destPoint()` = ostatni waypoint).
  Przechodzący przez pokój stoi na drodze, ale nie jest właścicielem i nikogo
  nie wypycha (`residentsOnly`). **Nigdy nie liczyć GŁÓW** — to był bug „trzech
  na jednym pikselu".
- **`combat` to umiejętność WRĘCZ i nic więcej (update38)**: czytana tylko przez
  `CrewMember.meleeDamage()`, XP tylko z `creditMeleeSwing()` przy ciosie. Żaden
  inny plik jej nie czyta (pilnuje tego test 100). Nie dodawać XP „za wygraną".
- **Żaden pocisk nie zdejmuje więcej niż JEDNEJ warstwy osłon (update38)** —
  `shieldDamage <= 1` w całej tabeli `WEAPON_DEFS`.
- **`run.mapProgress = { currentId, visited[] }`** — jedyny zapis pozycji na mapie.
  Pisany w `_saveShip()`, czyszczony w `_nextSector()` (id węzła należy do
  konkretnej mapy!). Odtwarzany przez `SectorMap.restoreProgress()`.
- **`MISSIONS[x]?.boss ?? 'station'` TO BUG** — `boss: null` jest celowe
  (Courier Run). Fallback wolno odpalić tylko dla NIEZNANEGO kontraktu.
- **Obsada modułu**: `crewInRoom()` = NASZA załoga (filtr `isPlayer === ship.isPlayer`);
  `occupantsOf()` = wszyscy w pokoju (ostrzał, stun, pożar); **`crewOperating()`**
  = obsada, ale pusta gdy pokój jest SPORNY (`roomContested`). Do manningu używać
  ZAWSZE `crewOperating`.
- **Historia służby załoganta**: `battles`/`wins`/`escapes`/`kills` — liczone
  w `Ship.onBattleStart()` (z `CombatManager.begin`, raz na walkę, oba statki),
  `_creditCrew()` w game.js i `creditKill()` w `strike()`/`receiveHit`.
- **Broń — KLASY** (update35): każde działo ma osobne pola `shieldDamage`,
  `pierceShields`, `hull_damage`, `moduleDamage`, `crewDamage:[min,max]`,
  `fireChance`, `breachChance`, `stunTime`. NIE używać `damage` do niczego poza
  zgodnością wsteczną. Role: LASER = moduł+załoga, rzadko pożar; RAKIETY = to samo
  + ignorują osłony, często pożar i dziura; ION = TYLKO osłony (0/0/0) + 1 s stuna
  modułu i załogi na pocisk; FLAK = 0 kadłuba, 0 modułu, mały dmg załogi, −2 paski
  osłon. Osłony zdejmują `shieldDamage` PASKÓW na trafienie.
- **Stun**: `ShipSystem.ionHit(sekundy)` → `_stunT` (odliczanie w SEKUNDACH,
  `ionDamage` to tylko zaokrąglony odczyt); `CrewMember.stun(sekundy)` blokuje
  ruch/zadania i rysuje iskry nad hełmem.
- **MAGAZYN BAZY TO JEDNA SIATKA** (`b.store`, `Base.warehouseGrid()`): He2,
  rakiety, broń i łupy to kontenery na tej samej `CargoGrid`. Przedmiot jest na
  półce ALBO w ładowni — nigdy w obu. Spakowana ładownia siedzi w `b.packedHold`.
  `Base.launch()` MUSI dostać `store` od wywołującego (BaseScreen), inaczej
  ponowny odczyt z zapisu wskrzesi wszystko, co gracz spakował.
- **Osłony**: poziom modułu 1-3 (piny = lvl×2, max 6), 2 moce/warstwa; +2 piny na upgrade;
  AKTYWNE od startu walki (prechargeShields); pierścień postępu ładowania na bąblu.
  Skill `shields` SKALUJE czas ładowania: `rechargeTime * (1 - Σ 0.15/poziom)`, limit 60%
  (do update34 był ODEJMOWANY — mistrz oszczędzał 0.45 s z 7, czyli nic).
- **Broń**: 1 działo = 1 moduł-pokój; poziom modułu wroga = koszt ⚡ działa; ładowanie wymaga
  OPERATORA w module (bez → charge zamarza, karta "NO CREW!"); broń NIEnaładowana na starcie walki.
  Skill `weapons` skraca ładowanie o 10%/poziom (suma po załodze w wieży, LIMIT 75% — bez limitu
  trzech mistrzów dawało `dt / 0`). Wszystkie ODCZYTY (kwadraciki, „Ns", pasek na kadłubie) liczą
  się z `chargeSeconds()` = czasu PO bonusie, nie z `def.chargeTime`.
  Statystyki broni pochodzą z JEDNEJ funkcji `weaponStatChips(def)` + `Renderer.STAT_ICONS`
  (canvas: `drawStatIcon`, DOM: `statIconSVG`) — nie pisać własnych stringów ze statami.
  Moduły broni gracza 2/3 dokupywane (konwersja pustego pokoju, wybór pokoju na blueprintcie).
- **Cyborg (Terra)**: +1 mocy wędruje z załogantem, CAPOWANE do workingLevels modułu (pełny moduł
  nic nie zyskuje); turkusowy pip w pasku. Moduł z cyborgiem DZIAŁA nawet przy 0 przydzielonej
  mocy (isDisabled liczy effectivePower — update18). Zwrot jednostki do banku reaktora TYLKO gdy
  moduł jest już w pełni zasilony — patrz `ShipSystem.reactorDraw()`, wspólne dla reaktora i
  pętli mocy w Ship.update().
  Pegasus: nie oddycha. Aquarius: nie płonie przy gaszeniu. Phoenix/inni: 2× XP (CORP_DEFS).
- **Drzwi**: binarne (zielone otwarte / czerwone zamknięte), przyciski OPEN/CLOSE ALL (ze śluzami,
  z ostrzeżeniem); załogant czeka aż drzwi się rozsuną (Door._tempT, _doorBlocking).
  Rozmiar w=6, h=34 dla WSZYSTKICH; Y z `Ship.floorDoorY(floor)` — jedna linia na piętro
  (wewnętrzne + winda + śluzy), update18.
- **Ogień**: rośnie co 9 s, spread co 12 s przez ściany NIEZALEŻNIE od drzwi, -1 HP kadłuba/6 s.
- **Tlen**: pasywny drain (O2 bez prądu = powolne duszenie), szybki przepływ przez otwarte drzwi,
  DRAIN_VACUUM 0.216. Priorytet auto-alokacji: oxygen→piloting→shields→weapons→engines→medbay.
- **Załoga**: multi-select ramką (press/drag/release), Shift, 2×klik=wszyscy; max 3/moduł;
  NIGDY nie stawiać załoganta na środku pokoju (`Ship.stationSpot()`) — środek to punkt kliku
  gracza, sprite o promieniu 13 px zjadałby rozkazy dla tego modułu;
  leczenie TYLKO w zasilonym medbayu; panel skilli na HOVER **tylko z listy po lewej**
  (sprite na statku NIE otwiera panelu — zasłaniał widok w walce, update22). Stany: injured(35% zamiast śmierci,
  także z uduszenia) / dead / decaying / infected. Żywy niesie rannego→medbay, trupa→śluza;
  niepochowane ciało gnije od NASTĘPNEJ walki (markCombatStart) i zaraża; zarażeni wędrują,
  czasem sami wychodzą śluzą. Klinika stacji: 12 CC/pacjent (full heal + leczy zarazę).
  RATOWANIE (update18): najbliższy wolny załogant idzie po rannego leżącego w INNYM pokoju
  (_rescueId); bez sprawnego medbayu opatruje go na miejscu (field aid). Zbieranie ciał ustępuje
  zadaniom REPAIR/BREACH/FIRE i pokojom, w których coś się pali/dziurawi/jest zbite.
  Śmierć = timer 1.2 s (anim.done nie działa — NIE wracać do anim.done!). crew.update guard
  TYLKO `if (this.dead)` — dying branch MUSI się wykonywać.
- **Boarding (FIZYCZNY)**: BOARD → zaznaczeni (tylko z NASZEGO statku) idą do śluzy gracza →
  wychodzą → lot 85 px/s → wyłamywanie śluzy wroga ~4 s (iskry, łuk postępu) → drzwi trwale
  otwarte → wejście **DOKŁADNIE do wyłamanego pokoju** (addCrew z keepPosition, update17).
  Próżnia: nie-Pegasus 2.2 HP/s. Abordażyści STEROWALNI (klik pokoju wroga, _ordered wyłącza
  auto-roam AI); klik w NASZ pokój ich NIE dotyczy — od tego jest RECALL.
  **RECALL** (update17): powrót przez własną śluzę, 1.5 s, bez trwałego wyłamania, śluza się
  zamyka. Walka w pokojach + sabotaż istnieją w crew.update. Kontra-abordaż po odmowie
  kapitulacji (60%). _makeParty/_updateParty/_drawParty w game.js obsługują OBA kierunki.
- **Cloak**: aktywny = 100% uniku (nie evasion!), 6 s / 22 s cooldown; bez prądu lub rozbity
  NIE ładuje się i NIE da się odpalić; trafiony/odcięty w trakcie → pole pada + pełny cooldown.
- **Energia**: rozkład gracza PRZECHODZI między walkami (`hasPowerPreference()`); domyślny
  rozdział tylko dla świeżego statku.
- **Walka**: pertraktacje przed walką 45% (danina: CC/załogant/walka), kapitulacja ≤30% HP 50%,
  ucieczka wroga ≤45% HP 45% (11 s, pasek, zbicie kokpitu/silników zeruje), retreat gracza 9 s
  spool (przycisk pod zasobami, zeruje się po knock-oucie napędu). AI chroni pilota i OSTATNIEGO
  strzelca (lastGunnerId). Nebula: 55% zasadzka, obie strony -2 mocy, fiolet fog.
- **Boss**: wariant zależy od kontraktu (BOSS_VARIANTS): `station` = boss_station (6 pięter,
  winda x=150, 3 działa, hull 40, crew 6) lub `elite` = enemy_gunship (hull 26, 2 działa, crew 4).
  Maszyna faz w _updateCombat PRZED CombatManager.update. Wznawia fazę po ucieczce;
  reset(variant) przy nowym kontrakcie. Wieloetapowi bossowie nadal TODO.
- **Mapa**: 6×3, zawsze 3 starty i 3 wyjścia; PASY (wyjście rzędem R → start rzędem R, Save run.lane);
  sektor 1: gracz wybiera pas (awaitingStartPick, banner — DARMOWY); ≥1 stacja/sektor; żadna
  kolumna pusta; ZERO elit (tylko boss kontraktu). Boss w sektorze `finalSector` (z kontraktu),
  `new SectorMap(sector, seed, lane, finalSector)`. Widok mapa⇄statek: przycisk + klawisz M.
  **Każdy skok kosztuje 1 He2** (update18); 50% szans na +1-2 He2 po walce.
  Skok przy 0 He2 → event **SOS** (`_maybeSOS`, update19), nie blokada. Gałąź "żebrz" zawsze
  daje paliwo — to zabezpieczenie przed softlockiem.
- **Sklep**: blueprint statku (klik moduł→upgrade, reaktor też; wybór pustego pokoju dla nowych
  modułów); zakładki repair(+klinika)/weapons(cargo, sprzedaż 50%, ⚡ wszędzie)/modules/crew(korporacje).
  Zakładki reactor NIE MA. Nowe moduły (cloaking, autorepair) losowo w stocku, startują BEZ mocy.
  Ceny w CC, paliwo He2.
- **UI**: status w 1 linii: EVADE→OXYGEN→bąble (wspólny styl _shieldBubble); notyfikacje dół-środek;
  panel modułów wroga: REAKTOR PIERWSZY z lewej; moduły broni w pasku energii NA KOŃCU obok kart dział.
  CLOAK: ikona modułu w pasku energii = przycisk (pierścień + sekundy), klawisz C; NIE ma już
  przycisku u góry ekranu. Waluta CC, paliwo He2 (patrz Utils.scrapStr/fuelStr).
  Ucieczka wroga: pasek + pulsujący trójkąt `!` nad kadłubem wroga z licznikiem sekund.
- **Stabilność**: guardy pętli w animation.update (frameDur>0 + cap 240), utils.wrapAngle (isFinite),
  audio scheduler (cap 64). dt clampowane do 0.05 w _loop. NIE usuwać tych guardów.

## 4. TESTY — **SĄ JUŻ W REPO** (od update17: folder `tests/`, nie trzeba odtwarzać!)
- Uruchamianie (z `C:\MoonWars\`, wymaga Node): `node tests/smoke_draw.js`, `node tests/run_tests.js`
  i `node tests/browser_test.js` (ten ostatni wymaga playwright; bez niego kończy się czysto).
  Testy NIE są ładowane przez index.html — nie wpływają na grę, są tylko dla asystenta.
- **tests/harness.js** — ładuje wszystkie js/*.js w kolejności zależności do jednego kontekstu vm ze
  stubami: Proxy-ctx (dowolna metoda = no-op), DOM, AudioContext (każdy AudioParam ma pełne API ramp!),
  localStorage, `HTMLCanvasElement`/`ImageBitmap` jako REALNE klasy (animation.js robi `f instanceof
  HTMLCanvasElement` — bez tego draw rzuca ReferenceError). Hoisting `const/let/class/function →
  globalThis` (inaczej host Node nie widzi klas z vm).
  `exposeGameInternals()` podmienia W PAMIĘCI `return { init };` na szerszy eksport `__test` (getterach
  z `typeof`-guardami) — plik na dysku NIE jest ruszany. Dzięki temu testy sterują prywatnymi
  `_updateCombat/_makeParty/_recallBoarders/_resolveEvent/_drawCombat` + settery STATE/ships/party.
  **Jeśli zmienisz linię `return { init };` w game.js — zaktualizuj GAME_EXPORT w harness.js.**
- **tests/smoke_draw.js** — **64 kroków** (ODTWORZONY OD ZERA w update43, patrz niżej).
  URUCHAMIAĆ PRZED KAŻDĄ PACZKĄ — łapie błędy renderowania, których testy logiki nie
  widzą, bo `run_tests.js` nie woła ani jednej ścieżki rysowania.
  Krok NIE kończy się na „nie rzuciło": tam, gdzie bug potrafił się schować za brakiem
  wyjątku, krok **asertuje na wyniku** (przechwytuje `fillText`/`fillRect`/`arc` z kontekstu
  i sprawdza, co naprawdę wylądowało na kanwie).
  Pokrywa: drawBackground (statyczny i przewijany), drawNebula, drawMainMenu (z hoverem i bez),
  `ship.draw` gracza / wroga (lustro) / stacji (zero kafli silnika i dziobu) / wraku
  (1 jednostka energii idzie na tlen), `crewByColor` dla KAŻDEGO stanu animacji w kolorze wroga,
  sprite szczura; drawMapScreen w pięciu wariantach (wybór pasa, zwykły sektor, tooltip węzła,
  **mgła** — ciemne węzły istnieją i nagłówek nie kłamie, **po sondzie** wszystko `known`,
  kontrakt bez bossa); drawHUD (mapa / walka / mgławica, **rząd bąbli osłon przy 6 warstwach
  nie schodzi z kanwy**, **pasek kadłuba przy 12/22/28/40/60 HP nie schodzi z kanwy**,
  **drużyna abordażowa zachowuje wiersze**, **wrogi intruz na naszym pokładzie ich NIE dostaje**);
  pasek energii z modułem CLOAK (READY / CLOAKED / RECHARGE / NO PWR + **kontrola stref
  klikania**: ikona cloaka odpala zdolność, każda inna przełącza moc, reaktora nie da się
  wyłączyć); **ekran BAZY** — wszystkie 6 zakładek klikanych PRZEZ STREFĘ i weryfikowanych
  po `BaseScreen._state().tab`, pusty hangar i puste koszary, obie listy hangaru w KAŻDEJ
  pozycji przewinięcia, przewinięty regał zbrojowni oddający **indeks BEZWZGLĘDNY**,
  karta w koszarach (HP, gwiazdki, WOUNDED, stary save bez pól hp → żadnego NaN),
  półka w SUPPLY, wzgórze cmentarza pusto/pełno z **czterema różnymi znacznikami**
  i najechanym nagrobkiem; `_drawCombat` w 7 wariantach (bez zaznaczenia, BOARD aktywny,
  ucieczka wroga — ten krok wykrył kiedyś krytyczny `W is not defined`, party w locie,
  RECALL aktywny, party wracająca, zwycięstwo z przyciskiem JUMP);
  drawRetreatBar, drawEventPopup, drawOutcome, UI.draw i **zawijanie powiadomień**
  (linia nie może wyjść poza 394 px pudełka, tekst nie może zginąć). Wymaga `Save.load()` + `startRun()`.
  Ostrzeżenia `[Assets] Sprite not found` są wyciszane — headless nie ma atlasów, a tysiąc
  takich linii zakrywało wynik.
- **tests/run_tests.js**: **2070 asercji w 145 sekcjach** (update46: 41 przepisana —
  ładownia ma jedno źródło szerokości; update45: 143 kot to
  bestia, 144 co kot robi, 145 odstraszanie i nagrobek; update44: 142 XP
  z osłon tylko za zestrzelone warstwy; update43: 136 jedna
  konsola jeden operator, 137 stawki XP w jednej tabeli, 138 mesa i promocja,
  139 kapitan kopiuje XP, 140 premie korporacyjne, 141 korporacje wrogów;
  update42: 121–135 — zaraza
  wentylacją, ranny ≠ martwy, koniec walki po `c.alive`, dźwięk/mute, pasek osłon wroga,
  skok bez He2 i latarnia raz na węzeł, abordaż: roster/leczenie/purge/`c.inRoom`,
  uzbrojone wnęki wroga, ogień przez zamknięte drzwi; update41: 119 siatka
  kadłubowa, 120 kafle silnika i dziobu; update40 — audyt:
  110 wycieki stanu, 111 zwłoki, 112 dźwięk, 113 zakresy włączne, 114 martwe
  oferty, 115 ucieczka kosztuje He2, 116 zawijanie powiadomień, 117 przewijane
  listy, 118 pasek kadłuba; update39: 106 He2 jako
  ładunek, 107 HP w koszarach, 108 mgła na mapie i sonda, 109 szczury; update38:
  97 osłony, 98 minimum załogi wroga, 99 kolor wroga, 100 zakres skilla combat,
  101 sloty w modułach, 102 pasek HP, 103 jaja we wraku, 104 filtr eventów,
  105 wznawianie kontraktu)
  (reaktor+cyborg, abordaż, RECALL, klik przy
  abordażystach, derelikt, cyborg zasilający moduł sam, naprawy, ratowanie rannych, He2 za skok,
  drzwi, winda dla rekruta, trwałość energii, cloak, SOS, **baza: launch/dokowanie**,
  **trwała strata**, **ekonomia bazy i limity**, **kontrakty/boss/brak elit**,
  **spójność index.html z js/**, **kadłuby scout/hauler**, **zbrojownia**, **sprzedaż statku**,
  **stacje+przeciwnicy**, **panel skilli**, **feedback walki+miniatury**,
  **zakładki stacji w stanach brzegowych**, **ładownia siatkowa: kształty/obroty/sąsiedztwo/ceny portów**, **ładownia w save'ie (i stary save bez niej)**, **ekran łupu**, **rozpakowywanie skrzyń**, **psucie ładunku przy skoku**, boot silnika).
  Każda sekcja FAILUJE na kodzie sprzed swojej poprawki — to prawdziwe testy regresji.
- Testy walki: begin() startuje w 'entering' — odczekać do 'active'; pętle muszą wołać też
  p.update(dt)/e.update(dt) (przepływ mocy po naprawie wraca dopiero w ship.update).
  W testach headless załoga NIE chodzi — pozycje ustawiać ręcznie (patrz `forceMuster()`),
  a wrogowi zabierać broń (`enemy.weapons = []`), żeby długa symulacja nie skończyła się porażką.
  Abordażyści w testach: rasa `pegasus` (nie duszą się w próżni podczas lotu).
- **tests/browser_test.js** — **61 asercji w 4 sesjach** (update21; ODTWORZONY OD ZERA
  w update43). Prawdziwa przeglądarka: Playwright + Chromium, repo serwowane po HTTP na
  `127.0.0.1`, prawdziwe kliknięcia w prawdziwych współrzędnych kanwy (przeliczanych
  z `getBoundingClientRect`, dokładnie tak jak `Input.toCanvas`), prawdziwe `pageerror`
  i `console.error`. **Filtr błędów patrzy na URL źródła** — arkusz ciągnie Orbitron
  z Google Fonts, a przeglądarka prosi o favicon; ani jedno, ani drugie nie mówi nic o grze.
  ŁAPIE to, czego harness nie może: brakujące pliki, realne API canvasu, DOM, błędy tylko-w-przeglądarce.
  Można też robić zrzuty ekranu (`page.screenshot`) — bardzo pomocne przy layoutach UI.
  – **Sesja 1** — boot, wszystkie pięć późnych modułów obecnych, ENTER BASE, **wszystkie
    zakładki bazy**, półka (dwusiatkowy PACK HOLD) otwarta i zamknięta, hangar, LAUNCH →
    kontrakt naprawdę startuje. **Zakładki klikane po STREFIE i sprawdzane po tym, KTÓRA
    się otworzyła** (`BaseScreen._state().tab`) — wcześniej pętla asertowała tylko „brak
    błędu", więc od ARMOURY w dół test przez wiele update'ów po cichu klikał w złe zakładki
    i nadal był zielony.
  – **Sesja 2** — serwuje „stary" `index.html` (BEZ tagów base/basescreen/cargo/lootscreen/wreck;
    plik na dysku NIE jest ruszany, podmiana leci w serwerze) i sprawdza samonaprawę:
    wszystkie pięć modułów doładowane w runtime, każdy oznaczony `data-autoloaded`,
    i — co najważniejsze — **ENTER BASE na naprawionej stronie naprawdę działa**.
  – **Sesja 3** — dwusiatkowy ekran łupu z **prawdziwym drag & drop** (mysz w dół, sześć
    ruchów, mysz w górę), napędzany PRAWDZIWĄ pętlą gry: skrzynia ląduje w ładowni, jest
    to TA SAMA skrzynia (po `id`, nie po nazwie), **i znika z półki** — przedmiot jest
    w jednym miejscu, nigdy w dwóch. Potem: zamknięcie ekranu zapisuje spakowaną ładownię
    do bazy, a osobno sprawdzany jest wrak (1 energia, tlen żyje, zero dział).
  – **Sesja 4 (update34): SKLEP NA STACJI** — jedyny test, który go w ogóle widzi, bo sklep
    to DOM, nie canvas: każdy chip statystyk ma własne SVG (i nie wszystkie takie samo),
    żadna etykieta nie zostaje gołym słowem, a **kwotowana cena reaktora ZAWSZE wystarcza
    na zakup** — test przechodzi reaktor poziom po poziomie do maksa, za każdym razem
    dając dokładnie tyle CC, ile poprosił przycisk (bug z §5-0 pkt 11). Pętla ma twardy
    licznik kroków: przy zepsutej wycenie test ma FAILOWAĆ, nie wisieć.
  – Bez playwrighta plik kończy się **czysto (rc 0)** — to dodatkowa para oczu, nie bramka.
    Gdyby `chromium.launch()` nie znalazł przeglądarki, próbowana jest jeszcze ścieżka
    z `MOONWARS_CHROMIUM` i `/opt/pw-browsers/chromium`, a potem czysty skip.
- **UWAGA (update43): `smoke_draw.js` i `browser_test.js` BYŁY RAZ STRACONE.** Nigdy nie
  były w gicie (`git ls-files tests/` pokazywał tylko `harness.js` i `run_tests.js`) i nie
  weszły do żadnego zipa `moonwars-updateN.zip`, więc gdy wypadły z folderu gracza, nie było
  ich skąd odzyskać — trzeba było napisać oba od nowa. Dlatego liczby kroków/asercji różnią
  się od sprzed update43 (było 32 / 45, jest 55 / 51). **Trzymać cały folder `tests/`
  w gicie i pakować oba pliki, kiedy się zmieniają.**
- Po zmianach balansu AKTUALIZOWAĆ stare testy zamiast "naprawiać" kod pod stare oczekiwania.
- **tests/break_check.js — PRZEBIEG ŁAMIĄCY.** Cofa po kolei KAŻDĄ poprawkę z historii
  projektu (dziś **368 rewersów**) i sprawdza, czy suita naprawdę się wywala. Test, który
  przechodzi na zepsutym kodzie, nie jest testem.

  **Jak go uruchamiać, żeby nie trwał trzech godzin (update72):**

  | polecenie | co robi | ile trwa |
  |---|---|---|
  | `node tests/break_check.js "#71"` | tylko rewersy nowej paczki | ~5 min |
  | `node tests/break_check.js "#71 the menu"` | jeden konkretny | ~40 s |
  | `node tests/break_check.js` | komplet | ~1 h |
  | `node tests/break_check.js --shard=1/2` + drugi checkout z `--shard=2/2` | komplet na dwa drzewa | ~35 min |

  **Shard musi być osobnym checkoutem** (`git archive HEAD | tar -x -C …`): rewers pisze po
  `js/` i przywraca plik, więc dwa shardy w jednym katalogu łamałyby sobie nawzajem pliki
  zamiast kodu.

  **Dlaczego jest szybszy.** Przez cały czas na każdy rewers startowały trzy suity, a one
  nie kosztują tyle samo: `run_tests` 9,3 s i **7000 złapanych** rewersów w historii,
  `smoke_draw` 0,3 s, `browser_test` **19,1 s i TRZY złapane** — wszystkie trzy to sklep
  na stacji, bo sklep jest DOM-em. Czyli dwie trzecie każdego przebiegu to przeglądarka
  odpowiadająca na pytanie, na które w całej historii projektu odpowiedziała trzy razy.
  Teraz `browser_test` leci w **baseline** (tam jest niezastąpiony: brakujący `<script>`,
  realne API kanwy) i tylko przy rewersach oznaczonych `browser: true`.

  Gdyby kiedyś wyciekł rewers, którego brakującym testem jest test przeglądarkowy —
  **oznaczyć ten jeden rewers**, a nie wstawiać przeglądarkę przed wszystkie 368. Raport
  „NOT CAUGHT" jest dokładnie od tego.

## 5. PUŁAPKI (nauczone bólem)
- **`const W` w game.js jest LOKALNE dla bloków przycisków** — nie czytać `W` w innych miejscach
  `_drawCombat`. Taki ReferenceError zabija CAŁĄ klatkę i wygląda jak zawieszenie gry (update19).
  Każdy nowy stan UI = nowy krok w tests/smoke_draw.js, inaczej nikt tego nie złapie.
- Skrypty patchujące: die-on-first-assert → część plików zapisana, część nie. Po KAŻDYM patchu
  weryfikować grepem stan na dysku. Łańcuchy `grep && cat > plik` — grep bez trafienia ucina cat!
- RAR zawiera więcej niż PROJECT.md sugeruje — najpierw grep, potem implementacja (boarding,
  lastGunnerId, perki ras JUŻ ISTNIAŁY gdy TODO twierdziło inaczej).
- Save niekompatybilny po zmianach struktur → zawsze pisać "nowy run".
- Serializacja systemów PO INDEKSIE; kupione moduły w extraModules ({type, roomId}) aplikowane
  PRZED odtworzeniem systemów.
- **Ustawienie `sys.power` z zewnątrz nic nie da** — `Ship.update` przelicza moc
  każdego modułu z budżetu reaktora CO KLATKĘ. Chcesz, żeby coś działało: daj
  temu `desiredPower` i zadbaj, żeby reaktor miał z czego. (Tak przez wiele
  update'ów „działające scrubbery" na wraku nie działały ani razu.)
- **`ship.crew` to WSZYSCY na pokładzie, także wrogowie.** Każde pytanie „kto
  obsługuje ten moduł" musi filtrować po stronie. Bez tego najeźdźca obsługiwał
  twoje działa i był leczony przez twój medbay.
- **Coś, co dzieje się „raz na walkę", ma jedno miejsce: `CombatManager.begin()`.**
  `markCombatStart()` jest wołane z trzech miejsc w game.js i podwaja liczniki.
- **Stan przypięty na stałe (`breached`) to stan, którego nie da się cofnąć.**
  Wybita śluza wentylowała pokój do końca runu, bo nie istniało zadanie, które
  by ją zamknęło. Wolimy timer, który sam wygasa.
- **Trzy magazyny na jedną rzecz to trzy okazje do duplikatu.** Liczniki +
  tablica + siatka wymagały `pruneHold`/`holdCost` tylko po to, żeby się nie
  rozjechać. Jedna siatka i inwariant „przedmiot jest w jednym miejscu" usunęły
  całą klasę błędów zamiast ją łatać. Jak widzisz kod uzgadniający dwa rejestry
  tego samego obiektu — usuń jeden rejestr, nie popraw uzgadnianie.
- **Zmiana stanu należy do update(), nie do draw().** Wyjście ze stacji siedziało
  w `_drawStation` i dlatego zapis „czasem" się nie wykonywał.
- **Zapisuj na WYJŚCIU z ekranu, na którym coś kupiono.** Pieniądze schodziły
  natychmiast (`Save.updateRun`), towar był tylko w pamięci — reload i masz
  wydane CC bez towaru.
- **Y w windzie nie należy do żadnego pokładu.** Każdy kod robiący `floorAtY`
  musi najpierw sprawdzić `_ridingShaft`, inaczej dostanie -1 i policzy bzdurę.
- **Dwie kopie tej samej liczby ZAWSZE się rozjadą.** Cena reaktora (przycisk vs kasa),
  czas ładowania broni (kwadraciki vs symulacja), statystyki broni (sklep DOM vs regał canvas) —
  za każdym razem ta sama choroba. Jeśli coś jest liczone w dwóch miejscach: zrób z tego JEDNĄ
  funkcję i skasuj drugą, nie „popraw obie". Skasowanie jest częścią poprawki.
- **Funkcja bez wywołań to nie martwy kod, to niedokończona mechanika.** `engineBonus()` i
  `Station.reactorCost()` siedziały bez ani jednego call site i obie były sednem zgłoszonego buga.
  Przy „coś nie działa" grepować NAJPIERW za nazwą bonusu/ceny i policzyć wywołania.
- **Odczyt musi liczyć się z tego samego, co symulacja.** Bonus działał, ale UI pokazywał wartość
  fabryczną — dla gracza to jest identyczne z „nie działa", tylko trudniejsze do zgłoszenia.
- **Piksele wpisane ręcznie w tabelę danych ZAWSZE się rozjadą.** Siedem
  layoutów statków miało własne współrzędne i wyprodukowało trzy rozmiary
  modułu oraz trzy skoki pokładu — a przystanki wind wpisane ręcznie sprawiły,
  że kabina na stacji bossa wystawała przez dach. Jak coś jest siatką, opisz to
  siatką i wylicz piksele.
- **`{ ...OBJ }` to kopia PŁYTKA — a stała modułu to stan globalny.**
  `_pickNodeType` „kopiowało" `NODE_TYPES` i zapisywało do oryginału, więc
  trudność mapy zależała od tego, jak głęboko zaszedłeś w POPRZEDNIM runie.
  Jak modyfikujesz kopię tabeli konfiguracyjnej — skopiuj też jej wpisy.
- **`?.()` na dźwięku/efekcie zamienia literówkę w ciszę.** Trzy sfx były wołane
  i nie istniały przez wiele update'ów. Każde API wołane opcjonalnie potrzebuje
  testu, który sprawdzi, że nazwa naprawdę istnieje — inaczej nie ma sygnału.
- **Sprzątanie na końcu `update()` potrafi skasować cały podsystem.** Jedna
  linijka `filter(c => !c.dead)` unieważniła noszenie zwłok, ostrzeżenie o
  rozkładzie, zarazę trupią i dwa znaczniki graficzne — bo biegła w tej samej
  klatce, w której ciało powstawało, a `_updateBodies` leci wcześniej.
  Zanim skasujesz obiekt „bo już nie żyje", sprawdź, kto jeszcze go czyta.
- **Stan, który się nie zeruje, wraca w najgorszym momencie.** `_wreckMode`
  miało JEDNO miejsce czyszczenia i przeżywało ucieczkę, przegraną i kontrakt.
  Każda flaga trybu musi być kasowana na KAŻDYM wyjściu, nie na tym jednym,
  o którym się pamiętało.
- **Test, który woła akcję ręcznie, nie widzi buga w ARGUMENCIE przycisku.**
  `_act('sellGun', 3)` przechodziło na wersji, w której przewinięty regał
  oddawał indeks widoczny zamiast bezwzględnego. Czytaj strefę kliknięcia
  (`_zonesFor`), nie wywołuj akcji za gracza.
- **Stub w teście może zaślepić cały wymiar.** `measureText` zwracał stałą 10,
  więc żaden test nie mógł zobaczyć napisu wychodzącego poza panel.
- **Liczba obok siatki to zawsze zapowiedź duplikatu.** He2 był ostatnim
  zasobem, który wychodził z półki jako JEDNOSTKI i lądował jako licznik —
  i dlatego dało się skoczyć z pustą ładownią. Wzór, który działa, jest jeden:
  siatka to prawda, licznik to LUSTRO odświeżane co klatkę, a wydawanie idzie
  przez `takeStack` z guardem na `countOf`. Tak zrobiono rakiety w update35
  i paliwo w update39; nie ma trzeciej drogi.
- **Komentarz w nagłówku pliku też się psuje.** `cargo.js` przez cztery update'y
  twierdził, że „He2 i rakiety zostają zwykłymi liczbami", długo po tym, jak
  rakiety przestały nimi być. Jak zmieniasz model danych — popraw notatkę,
  która go opisuje, bo następna osoba przeczyta ją zamiast kodu.
- **Test na rzucie losowym musi się powtarzać.** „Szczur nie dostaje noszy"
  przechodziło na ZEPSUTEJ wersji, bo rzut „ranny zamiast martwy" to 35% —
  jeden szczur to moneta. Czterdzieści szczurów to test.
- **Test musi iść tą samą drogą co gra.** „Wraki nie płoną" sprawdzało wraki
  z `makeDerelict`, a pożar zapalał się w `_startWreckBoarding` — psucie
  przechodziło niezauważone. Testuj wejście, którego naprawdę używa gracz.
- **`?? 'domyślne'` na polu, którego `null` COŚ ZNACZY, to bug.** `boss: null`
  w Courier Run znaczy „ten kontrakt nie ma bossa"; `null ?? 'station'` zamieniło
  to w Apophis na mapie jednosektorowej dostawy. Fallback wolno odpalać tylko
  dla wartości NIEZNANEJ, nie dla świadomego `null`.
- **Liczenie GŁÓW zamiast MIEJSC zawsze się rozjedzie.** „Ilu ich tam jest, to
  ty bierz następny slot" pęka na dwa sposoby: ten w pokoju sam może stać na
  slocie, który ci przydzielasz, a kilku wysłanych naraz mierzy pokój, zanim
  którykolwiek ruszy. Pytaj, KTÓRE miejsca są zajęte — i licz idących tam jako
  zajmujących.
- **Pole wpisane w tabelę danych ≠ pole obsłużone.** `system_upgrade`, `cost`
  i `system_damage` siedziały w `EVENTS` od dawna i nikt ich nigdy nie czytał —
  event „ulepszę ci medbay" nie robił NIC. Przy dodawaniu pola do tabeli danych
  od razu grep za konsumentem; brak wywołań to niedokończona mechanika (patrz
  wyżej: `engineBonus`).
- **Sprite'y „domyślne" mają kolor gracza.** `Animation.crewRepair/crewFight/crewDie`
  generują się w niebieskim; tylko `idle`/`walk` miały wariant wroga. Każdy nowy
  stan animacji musi iść przez `crewByColor(state, suitColor())`, inaczej wróg
  zmieni stronę w połowie walki.
- **Linia CHODZENIA (`floorWalkY`) ≠ linia DRZWI (`floorDoorY`).**
  Logika ruchu jedzie po pierwszej, rysowanie drzwi/szybu/kabiny po drugiej. Mylenie ich
  to był „pusty szyb niżej niż drzwi" (update34). **Od update73 obie liczą się po
  WNĘTRZU modułu, nie po module** — kanał wentylacyjny to sufit i ani stopy, ani właz
  nie mają w nim czego szukać. Linia chodzenia ma dokładnie jedno źródło:
  `walkOffset()`. Wcześniej miała trzy (`HULL_GRID.WALK_FRAC`, `buildHull`, i gołe
  `0.65` w `floorWalkY`) i zgadzały się tylko dlatego, że sufit był chodliwy.

## 5-0. ZMIANY update97 (NAJNOWSZE — POPRAWKI Z GRANIA 94–96)

Lista jj z 06.10 (15 punktów). Dwa o tabliczkach (skąd się biorą w sektorach, Re-Atum
jednorazowy) poszły do planu `claude/projekt-kapitan-wiedza-tabliczki.md` — tabliczek
jeszcze nie ma w kodzie. Punkt „powietrze w menu skrzyń" sprawdzony testem: w oknie łupu
gra stoi (STATE 'loot' nie woła `_updateCombat`), zegar skafandra się nie rusza — po prostu
zbiornik 8 s kończy się w drodze i przy cięciu (Pegasus 26 s daje radę). Bez zmiany.

### 1. Panel wroga — `renderer.js` (`_drawEnemyModules`)
Kolumna reaktora wroga czyta się jak nasza: od dołu jednostki robocze, **kara mgławicy na
fioletowo** (`#8a3fbf`), zestrzelone na czerwono. Obok **pasek ciepła** (te same kolory i
progi), pod ikoną zawsze **temperatura w °C** + „NEB −N" w mgławicy. `enemyHeatBar()` dla testów.

### 2. Ciepło w °C — `ship.js`
`REACTOR_HEAT_CONFIG.maxCelsius = 1300`, `heatCelsius(h)`. Symulacja dalej 0–100 (progi bez
zmian); ekran mówi stopnie: pasek gracza, panel wroga, karta reaktora („Core 845 °C of 1300…").

### 3. Wolniejsza naprawa — `systems.js`
`SYSTEM_REPAIR_RATE = 0.10` (było 0.12): poziom w 10 s zamiast 8,3 s dla nieumiejętnego.

### 4. Czerwona poświata — `ship.js`
Przy kadłubie < 35% poświata idzie po **ścieżce płyty kadłuba** (`_hullPlatePath(-4)`), nie po
prostokącie — nic czerwonego tam, gdzie nie ma modułów.

### 5. Niebieski ogień — `fire.js`, `particles.js`
`FIRE_DEFS.STARVED_O2 = 0.40`: poniżej 40% powietrza `fire.starved` → płomień, cząstki i kula
Zero-G w odcieniach niebieskiego (`Particles.FIRE_COLOURS_STARVED`). Gaśnie jak dotąd < 8%.

### 6. Osłony — `game.js`, `systems.js`, `ship.js`
- Nasze **nie ładują się same przy skoku** — warstwy przechodzą z poprzedniego miejsca
  (`resetShieldDebt()` zamiast `prechargeShields()` w zwykłej walce, przy bossie i wraku).
  Rozkaz EMERGENCY BUBBLE dalej ładuje do pełna.
- **Generator w naprawie nie ładuje**: `repair()` stawia `_repairHold = 0.25 s`,
  `_updateShields` czeka, póki trwa.

### 7. Wróg na stanowiskach — `game.js`, `ship.js`, `boss.js`
`Ship.snapToStations()`: załoga od razu na swoich miejscach (bez chodzenia), osłony pełne.
`ENEMY_SURPRISE_ODDS = 0.20`: co piąta walka **z mapy** (`canSurprise` tylko przy skoku na
węzeł) — zaskoczeni: ludzie gdzie byli, osłony zimne, komunikat. Walki z eventów, pułapki SOS,
odrzucona rozmowa — zawsze gotowi. Boss zawsze gotowy.

### 8. Kto naprawia — `combat.js` (`_updateAI`)
**Stanowiska bojowe zostają obsadzone**: operator kokpitu, każdej broni z działem i konsoli osłon
nie jest wysyłany do naprawy innych modułów (swój naprawia na miejscu, jak dotąd). Naprawiają
i gaszą pozostali. Bez wolnych rąk tylko reaktor albo ogień może zabrać człowieka z osłon (albo
drugiego działonowego) — nigdy pilota ani ostatniego działonowego. Załoga wroga liczona na to:
pilot + działa + osłony + **1 zapasowy** (+1 elita).

### 9. Ranni wroga się leczą — `combat.js`, `crew.js`
`ENEMY_HEAL_AT = 0.40`, `ENEMY_HEALED = 0.90`: poniżej 40% HP idzie sam do działającego medbaya
(gdy na statku nie ma pożaru ani dziury), wyleczony wraca na stanowisko. `_healing` /
`_healRoomId` — w `TASK.IDLE` jego „posterunkiem" jest wtedy medbay.

### 10. Łup — `game.js`, `cargo.js`
- **Broń z rozwalonego statku ląduje w skrzyni** (`_spawnSalvage` wkłada `weaponDrop` jako
  skrzynkę z działem; gdy się nie mieści — nowa skrzynia). `_onWin` montuje broń tylko gdy
  nie ma wraku (`_salvageWillSpawn()` = fałsz: boss, hulk).
- **Apteczki**: z apteczki wroga połowa razy przeżywa jedna skrzynka 1–3 dawek
  (`SALVAGE.MED_SURVIVE 0.5`, `MED_DOSES [1,3]`) zamiast całych 2–4 pełnych pudełek; w tabeli
  łupu waga 13 → 6.

### 11. HEAL w menu załoganta — `ship.js`, `game.js`, `renderer.js`
Obok FEED wiersz **HEAL**: jedna dawka, chwila zajętych rąk (`_startBusy('heal')`), potem
`_finishHeal`: zaraza (nie wirus) najpierw, inaczej +25 HP (`Ship.HEAL_HP`). Odmowy w
`healRefusal` (nie ranny / leży — to MEDKIT / brak dawek / ręce zajęte).

### 12. Ranga w oknie załoganta — `ui.js`, `renderer.js`
Dymek nad insygnium usunięty (nachodził na okno załoganta). W oknie po najechaniu na wiersz:
insygnium + ikony specjalizacji + „Stopień (N)".

### 13. Lista załogi się przewija — `renderer.js`, `game.js`
Kółko nad listą przesuwa okno (`scrollRoster`, `rosterBox`); linia pod listą „▲N ▼M · WHEEL"
zamiast „+N MORE". Wybrany załogant zawsze trafia w okno (TAB, klik na pokładzie).

### 14. Testy
Sekcja **284**. Przerobione: sekcja 276 (stopnie), sekcja z parley (`canSurprise`), menu
(FEED + HEAL), lista bez „+N MORE", sekcja 283 (brak dymka). run_tests **6505**, smoke **86**,
browser **90**. `break_check.js`: **26 rewertów `#97`** + 8 przekotwiczonych (#69, #77, #82×2,
#92×3, #96→#97 dymek). Razem **1078 wpisów, 0 złych kotwic**. Przebieg 1: 27/27, przebieg 2: 27/27; przekotwiczone (#69, #77, #82, #92, #96) — wszystkie złapane.

### Do sprawdzenia w grze
Czy co piąta walka „zaskoczona" to dobra częstość; czy wróg z zapasowym człowiekiem nie jest za
mocny w abordażu; tempo naprawy 10 s/poziom; HEAL za 1 dawkę (+25 HP).

## 5-0a. ZMIANY update96 (25 INSYGNIÓW RANG ZAMIAST GWIAZDKI, IKONY SPECJALIZACJI)

Pkt 14 z listy 29 punktów (30.09): „lista załogi z 25 odznakami (rysowane w kodzie) i
ikonami specjalności; stare gwiazdki precz". jj 03.10: grafika — **tylko skóra** (bez
przesuwania elementów). Łatanie „do kwadratu" okazało się naprawione już w 93a.

### 1. Insygnia — `renderer.js`
`RANK_INSIGNIA[0..24]`: lista prymitywów (te same co `STAT_ICONS`: poly/circle/line/rect,
plus `['col', …]` do zmiany koloru w środku) w pudełku 20×10. `drawRankInsignia(ctx, lvl,
x, y, h)` — wysokość h, szerokość 2h, zwraca szerokość; poza zakresem = koniec drabiny.
Rodziny (`INSIGNIA_TIERS`, `insigniaTier`):
- 0–8 szeregowi, stal `#c8d0dc`: pusta zakładka (Recruit), 1/2/3 krokwie, rockery dla
  starszych, romb Specialisty;
- 9–11 chorążowie, turkus: belka + 1/2/3 kropki;
- 12–17 oficerowie, złoto: pusta belka, pełna, dwie belki, potem 1/2/3 kropki;
- 18–22 flaga: 1–4 gwiazdki, Grand Admiral = 4 nad belką;
- 23–24 lordowie: korona; Master Lord z trzema karmazynowymi klejnotami.
Ranga dalej liczona tylko przez `rankLevelOf`; insygnia to wyłącznie wygląd.

### 2. Specjalizacje — `renderer.js`
Trzy nowe ikony w `STAT_ICONS`: `sk_pilot` (wolant), `sk_gun` (celownik), `sk_engine`
(dysza z wydechem). `SKILL_ICON` mapuje 8 umiejętności (pięć używa istniejących: repair,
fire, breach, shield, fight). `specialtiesOf(rec)` = umiejętności na 3/3
(`Commander.masteredOf`). `drawSpecialties(ctx, rec|lista, x, y, size, gap)` — ikona w
kolorze umiejętności, zwraca szerokość. `rankTip(rec)` = „Sergeant (6) · specialist: …".

### 3. Gdzie — gwiazdka usunięta wszędzie
- Lista w walce: insygnium (9 px) w prawym górnym rogu wiersza; najechanie → dymek z
  `rankTip`. Strefy w osobnej liście `getRankZones()` (lista znaczników stanu ma swoje testy).
- Koszary: insygnium + ikony specjalizacji za imieniem.
- Mesa: insygnium za imieniem, ikony przed „specialisations (3/3): …".
- Teczka dowódcy: insygnium przed nazwą stopnia, ikona przy każdej specjalizacji.
- `ui.js` `drawCrewPanel` (nieużywany, ale wystawiony): insygnium.
- Usunięte: `starForRank`, `CrewMember.getStarRating`, `_crewStar` w basescreen.
  Gwiazdka na cmentarzu (dowódca / bohater) zostaje — to nie ranga.

### 4. Testy
Sekcja **283** (25 różnych obrazków, rodziny i kolory, więcej tego samego znaku wyżej,
8 ikon umiejętności, specjalizacja tylko 3/3, dymek, lista w walce maluje własne
insygnium, mesa i teczka, gwiazdki nie ma). Przerobione: sekcja z koszarami (szpieg na
insygnium/ikonach zamiast „★"), sekcja z drabiną rang (gwiazdka zniknęła),
`smoke_draw` krok koszar.
run_tests **6446**, smoke **86**, browser **90** (też na kopii z `git archive`).
`break_check.js`: **16 rewertów `#96`**, razem **1052 wpisy, 0 złych kotwic**.
Przebieg 1: 14/16 — przecieki: lista specjalizacji czytana jako człowiek (test patrzył na
argument, nie na rysunek) i lista w walce bez insygnium (test liczył strefy); oba testy
sprawdzają teraz, co namalowano. Przebieg 2: **16/16**.

### Do sprawdzenia w grze
Czytelność insygniów w 9 px na liście w walce (szeregowi 4–8 blisko siebie — pełna nazwa
w dymku), czy dymek nie zasłania czegoś ważnego.

## 5-0b. ZMIANY update95 (OSIEM KADŁUBÓW Z RYSUNKÓW JJ, TORPEDY U WROGA)

jj, 03.10: osiem planów (niebieskie moduły, zielona winda). Odpowiedzi: część do kupienia,
reszta wróg; goły bok windy = zwykła ściana; moduły rozstawia Claude. Wróg „czasem"
dostaje wyrzutnię torped, tylko jako drugą broń. Balans 94 bez zmian (jeszcze nie grane).

### 1. Osiem układów — `ship.js` (`SHIP_LAYOUTS`)
Wszystkie na tej samej siatce: kolumny 0-1, winda (`shaftAfter: [1]`), kolumny 2-3.
Górny rząd rysunku = najwyższy `row`.
- **Do kupienia** (`base.js` `SHIP_CATALOG`). jj (03.10, po pierwszej wersji): nie w pełni
  wyposażone — 5 podstaw (silniki, kokpit, O₂, reaktor, jeden moduł broni) + JEDEN dodatkowy
  moduł, na każdym inny; reszta zatok pusta. Różne bronie, ładownie wg roli. Najdroższy
  ma drugi moduł broni jako dodatek i dwa działa.
  - `thoth` „Thoth" 280 CC: dodatek **medbay**; Burst Laser II; reaktor 8/16; ładownia 6×3; 2 puste.
  - `isis` „Isis" 380 CC: dodatek **osłony** (1 warstwa); Heavy Laser; reaktor 9/18; ładownia 7×4; 4 puste.
  - `osiris` „Osiris" 420 CC: dodatek **drugi moduł broni**; Heavy Laser + Burst Laser II;
    reaktor 10/20; ładownia 6×4; 4 puste.
  Działo jonowe odpadło jako jedyna broń (0 obrażeń kadłuba). `startSystems` jest tylko
  opisowe — moduły tworzy typ pokoju.
- **Wróg**: `enemy_ra` „Ra" (7, medbay), `enemy_nephthys` „Nephthys" (8, **2 działa**,
  medbay; środkowy pokład to sam szyb), `enemy_khnum` „Khnum" (6, schodki),
  `enemy_hathor` „Hathor" (6, 2 pokłady), `enemy_montu` „Montu" (6, 2 pokłady).
  Celowo **bez pustych zatok** — `_seatCaptives` wstawia celę w pierwszą pustą, więc
  zapasowa zatoka podniosłaby częstość jeńców. Ósmy/siódmy pokój to medbay.
- Sąsiedztwo przez szyb wpisane jak w starych kadłubach (kanał, ogień przez drzwi windy).

### 2. Winda i śluzy — `ship.js`
- `buildHull`: winda zatrzymuje się **tylko na pokładach z modułem** (Nephthys: 2 przystanki
  na 3 pokłady; kabina przejeżdża przez środek).
- Śluzy: nadal na skrajnej ścianie skrajnego modułu pokładu, ale **nigdy na ścianie przy
  szybie** (`wallOnShaft`, tolerancja 26 jak drzwi windy — szyb ma 28 px, nie 30).
  Goła strona szybu to płyta kadłuba. Stare kadłuby bez zmian (żaden nie miał modułu
  skrajnego przy szybie).

### 3. Losowanie wroga, wraki, torpedy — `game.js`, `wreck.js`
- `ENEMY_POOL` = stare 3 + Ra, Khnum, Hathor, Montu (od sektora 1). Nephthys: w zwykłym
  losowaniu od sektora 2, u elit/poszukiwanych od razu.
- `ENEMY_TORPEDO_ODDS = 0.25`: od sektora 2 drugi slot wroga (pętla „każda zatoka ma
  działo") może dostać `torpedo_launcher`; pierwszy nigdy. Wróg nie liczy amunicji, więc
  bez stojaków. Dotyczy też bunkra (ma 2 sloty). Boss idzie przez `BossManager.start`,
  nie przez `_spawnEnemy`.
- `DERELICT_LAYOUTS` + Ra, Khnum, Hathor, Montu; lista wystawiona na `window` dla testów.

### 4. Testy
Sekcja **282** (plany moduł po module, kto czym lata, śluzy nigdy przy szybie, Nephthys
2 przystanki, załogant dochodzi do każdego modułu na 8 kadłubach, losowanie w sektorach
1/3 i elity, torpeda tylko w 2. slocie i zasilona, wraki, 6 kadłubów w stoczni).
Sekcja 282 sprawdza też wyposażenie stoczni: 5 podstaw + dokładnie 1 dodatek, różne dodatki,
Osiris 2 działa, różne bronie, każda rani kadłub, reaktor uciąga wszystko, ładownie wg roli.
Zmienione stare: sekcja 63 (lista bogów + Khnum, Hathor, Montu), sekcja z siatką
(pokłady „całkowitą liczbą pokładów od siebie", przystanki = pokłady z modułem), sekcja
247 (gracz = klucze `SHIP_CATALOG`, nie wpisana lista).
run_tests **6377**, smoke **86**, browser **90** (też na czystej kopii z `git archive`).
`break_check.js`: **20 rewertów `#95`**, razem **1036 wpisów, 0 złych kotwic**.
Przebieg 1: 20/20, przebieg 2: 20/20 (+ kontrola `#94` 24/24).

### Do sprawdzenia w grze
Czy hangar dobrze pokazuje 6 kadłubów (lista przewijana po 3), czy 3-pokładowe kadłuby
wroga mieszczą się obok 3-pokładowych gracza, ceny 280/380/420.

## 5-0c. ZMIANY update94 (BUNKRY I MECH)

Plan dema (01.10) + odpowiedzi jj z 02.10, 21:52.

### 1. Pancerz — `ship.js` (`receiveHit`)
`Ship.armor` = `layout.armor` (0 dla wszystkiego, co lata; 1 — bunkry, mech, Apophis).
Każde trafienie: kadłub i moduł −armor (pasek kadłuba też). Załoga dostaje TYLKO gdy
trafienie przebija (`max(hull_damage, moduleDamage) > armor`), i wtedy połowę. Zwykły
laser odbija się (napis ARMOUR), rakieta / ciężki laser wchodzą z 1, działo 2, torpeda 2.
Rysunek: stalowa obwódka kadłuba; panel wroga — trzecia pigułka „ARMOUR −1 / hit".

### 2. Bunkry i mech — `ship.js`, `game.js`, `combat.js`
Nowe układy: `bunker_small` („Sekhmet", 2 pokłady, 2 działa, silniki 2, `immobile`
→ unik 0) i `enemy_mech` („Ptah", wieżyczka na górze, szeroki korpus na gąsienicach,
`slow` → połowa uniku, `tracks` → `_drawTracks`: taśma, ogniwa, kręcące się koła). Bez
osłon i bez maskowania; silniki trzymają grawitację jak wszędzie. `grounded`: nie
uciekają (ani rzut przy 45% kadłuba, ani „60 s bez obrażeń"), bez poświaty silników.
Spawn (`_spawnEnemy`): od sektora 2, `GROUND_ODDS` bunkier 12%, mech 10%; nigdy elita
ani poszukiwany; +4 kadłuba. Apophis (`boss_station`) = wielki bunkier: grounded,
immobile, armor 1, bez osłon (pokój `r_shields` pusty), silniki 3.

### 3. Torpedy — `weapons.js`, `cargo.js`, `combat.js`, `station.js`, `ui.js`, `renderer.js`
`torpedo_launcher` („Torpedo Tube"): 3 obrażeń, ignoruje osłony, ładowanie 24 s, moc 2,
`torpedoUse: 1`, `minSector: 2`, 80 CC. Osobna amunicja: `torpedo_rack` (stos 4) w
ładowni. `weaponAmmo(def)` → {kind 'torpedoes'|'missiles', use, word} — jedno źródło
dla odmowy strzału, poboru i „NO AMMO" na karcie. Sklep: torpedy od sektora 2
(`stock.torpedoes`, 14 CC/szt., `buyTorpedoes`, karta TORPEDOES), wyrzutnia też dopiero
od 2 (pula broni + czarny rynek + łup filtrują `minSector`). Pasek zasobów: `T<n>`, gdy
na pokładzie jest wyrzutnia lub torpedy.

### 4. Terra: zbiornik 16 — `crew.js`
`SUIT_AIR.TANK.terra = 16` (podstawa mniejsza).

### 5. Testy
Sekcja **281**; sekcja 147 porównuje teraz zwykły skafander z aquarius.
run_tests **5720**, smoke **86**, browser **90**. `break_check.js`: **24 rewerty `#94`**
+ 4 przekotwiczone (`#ammo` ×2, `#68`, `#93` boss). Razem **1016 wpisów, 0 złych kotwic**.
Pierwszy przebieg 22/24 — przecieki: unik bunkra (test mierzył bunkier bez pilota; teraz
porównanie z tym samym kadłubem „ruchomym", a `bunker_small` dostał reaktor 10, bo 8 nie
starczało na 9 pipsów) i osłony Apophisa (rewert przeniesiony na typ pokoju `r_shields`,
to on tworzy moduł); przekotwiczone 4/4. Drugi przebieg: **24/24**.
Czarny rynek też filtruje `minSector` (wyrzutnia nie trafi tam w sektorze 1).

## 5-0d. ZMIANY update93c (POPRAWKI Z GRANIA 93b)

Cztery uwagi jj z 02.10 wieczorem.

### 1. Plakietka reaktora w module — `systems.js`, `ship.js`
Reaktor nigdy nie dostaje prądu (jest źródłem), więc `isDisabled()` zawsze mówiło
„wyłączony" i plakietka w rogu modułu była szara. Teraz dla reaktora: świeci, gdy ma
sprawny poziom i nie jest w SCRAM (`sys._offline` ustawiane przez Ship.update), szara —
SCRAM albo wszystkie poziomy zbite.

### 2. Worek z wrogiem: 20 CC tylko na stacji badawczej — `cargo.js`, `ui.js`
`ENEMY_BODY_PRICE = 20`; `value('science')` = 20, każdy inny port 0. Nowe
`CargoItem.sellRefusal(port)`: nasz zmarły — „one of your own…", wróg poza stacją
badawczą — „only a research post buys these". Karta w porcie pokazuje NOT FOR SALE,
SELL EVERYTHING je pomija (dawniej sprzedawało naszego zmarłego za 0 CC). Pirat z listy
gończej — jak dotąd jego nagroda. W bazie worek z wrogiem dalej = nagrobek NN.

### 3. Jeden pocisk jonowy = jeden poziom — `systems.js`, `renderer.js`, `ship.js`
`ionHit(seconds, levels = 1)`: każdy pocisk blokuje JEDEN poziom na swój czas
(`_ionLocks`, osobne liczniki); `ionDamage` = ile poziomów zablokowanych;
`effectivePower` odejmuje je (już nie zeruje modułu). `isDisabled` bez warunku „jakikolwiek
jon". Silniki 2 poziomy: jeden pocisk — grawitacja zostaje, dwa — Zero-G. Ikona „broken"
tylko gdy jon zbił wszystko; na pasku niebieskie są tylko zablokowane pipsy (górne).
Zwarcie od szczura dalej gasi cały moduł (`ionHit(…, sys.level)`).

### 4. Ładownia grzeje reaktor — `ship.js` (`REACTOR_HEAT_CONFIG.cargo`)
`cargoHeatRate()` = rdzenie (`unstable_core`, tag rad) × 100/600 − chłodnice
(`cooler_crate`, tag cool) × 100/600 na s, gdziekolwiek w ładowni; dodawane do
`reactorHeatRate()` (dotychczasowe pasma → `_loadHeatRate()`). Rdzeń + chłodnica = 0;
sama chłodnica chłodzi. Karta reaktora: „Hold: N unstable cores, M coolers — heating /
cooling / cancelled out".

### 5. Testy
Sekcja **280**; wzmocniony losowy test z 279 (mały wróg klasy 0 = zawsze 1 skrzynia).
run_tests **5586**, smoke **86**, browser **90**. `break_check.js`: **15 rewertów `#93c`**
+ 2 przekotwiczone (`#89` zwarcie, `#90a` ikona). Razem **992 wpisy, 0 złych kotwic**.
Pierwszy przebieg 15/15, przekotwiczone 2/2; drugi: **15/15**.

## 5-0e. ZMIANY update93b (LUTOWANIE WRAKU, NIKT NIE ZOSTAJE PRZYPADKIEM)

Pomysł jj z 02.10 + jego liczby (18:33): lutowanie 2–3 s, 1–4 skrzynie (większy wróg =
więcej i lepiej), niektóre puste, otwarcie = okno dwóch ładowni, tlen jak przy
abordażu, można odlecieć w każdej chwili — kto jest na zewnątrz, przepada; tak samo
abordażyści na wrogu, gdy uciekamy albo gdy wróg wybucha.

### 1. Szczątki po zniszczeniu — `game.js` (sekcja SALVAGE), `combat.js`
- **tylko kadłub zniszczony** (hull ≤ 0); wybita załoga przy całym kadłubie = hulk jak dotąd
- `_spawnSalvage()`: klasa wroga = min(3, hullMax/10) + (2+ działa) + (dowódca);
  skrzyń `randIn(1, 1+klasa)`, max 4; każda 20% pusta (`SALVAGE.EMPTY_CHANCE`), reszta
  `makeWreckGrid(sektor + klasa/2, 3×3, 1..2+klasa prób)`; **ładunek wroga** (apteczki)
  trafia do niepustych skrzyń
- stan żyje na `CombatManager.salvage` (`begin()` czyści; tam też `_salvageRolled`
  i `_downHandled` — raz na walkę liczone po walce CombatManagera, nie po fladze gry)

### 2. Wyprawa — `game.js`
- zaznacz załoganta → klik w skrzynię: idzie do naszej śluzy od strony wraku, wychodzi
  (znika z `ship.crew`), leci 85 px/s, tnie **2,5 s** (`SALVAGE.CUT_SECONDS`), otwiera
- **powietrze z własnego skafandra** (`SUIT_AIR.TANK`: 8 s zwykły, **26 s Pegasus**);
  dopiero gdy pusty: 2,2 HP/s (jak lot abordażowy). Zwykły traci kilka–kilkanaście HP
  na dalszą skrzynię, Pegasus wraca bez straty i robi dwie skrzynie na jednym zbiorniku
- klik w kolejną skrzynię tym samym (zaznaczonym) człowiekiem = **kolejka** na tej samej
  wyprawie; po ostatniej wraca, wchodzi śluzą
- otwarcie: pusta → komunikat „empty", skrzynia znika; pełna → `LootScreen.openLoot`
  (SALVAGE / CRATE / DONE); co zostawisz, dryfuje dalej (skrzynia „OPEN", można wrócić)
- na zewnątrz: liczony do załogi (nie ma przegranej, gdy wszyscy wyszli), na liście
  po lewej (`Renderer.setEvaCrew`, `_awayTeam`), klikalny w przestrzeni; nad głową
  zawsze pasek powietrza; skrzynia z imieniem idącego / SEALED / OPEN, łuk postępu cięcia

### 3. Nikt nie zostaje przypadkiem — `game.js`
- JUMP z ludźmi na zewnątrz: **pierwsze wciśnięcie ostrzega** (kto), drugie w 4 s
  skacze; zostawieni giną (`killOutright`, na pomniku jako NOT RECOVERED)
- RETREAT (spool 9 s): ostrzeżenie „RECALL them before the jump"
- `_recoverBoarders(opts)`: `aboardLost` / `flightLost` — **wróg wybucha** → nasi na
  jego pokładzie giną, ci w kapsule wracają; **my uciekamy** → na wrogu i w kapsule
  przepadają; **wróg ucieka** → na jego pokładzie przepadają; boss pokonany → jak
  wybuch. Kapitulacja / hulk — wracają jak dawniej

### 4. Testy
Sekcja **279**, smoke krok 86 (skrzynie + człowiek w skafandrze). Poprawione stare:
sekcja z wycinkiem źródła wyjścia po zwycięstwie (okno 620 → 900 znaków). run_tests
**5564**, smoke **86**, browser **90**.

`break_check.js`: **24 rewerty `#93b`**, razem **977 wpisów, 0 złych kotwic**. Pierwszy
przebieg 22/24 (wybita załoga nigdy nie dochodziła do zwycięstwa w teście — teraz
wymuszone; apteczki wroga nie do odróżnienia od apteczek z tabeli wraku — teraz znacznik,
którego tabela nie losuje). Drugi: **24/24**.

### 5. Uwaga dla jj
Duży zbiornik ma **Pegasus** (26 s), nie Terra (8 s jak wszyscy) — Terra daje +1 prądu.
Jeśli Terra też ma mieć większy zapas, to jedna liczba w `SUIT_AIR.TANK`.

## 5-0f. ZMIANY update93a (POPRAWKI Z GRANIA + DECYZJE JJ)

Lista jj z 02.10 (testy grane na 90–90b, przed 91) + jego decyzje do 93.
Z listy już załatwione wcześniej: ucieczka wroga po 60 s (93), walka w parach (93).

### 1. Nagrobek NN — `save.js`, `base.js`, `basescreen.js`
`Save.addUnknownGrave()` — rekord `{ enemy: true, name: 'NN', buried: true }` (bez
służby, nigdy na NOT RECOVERED); dok woła go przy każdym worku z wrogiem. Na wzgórzu
**pochylony pal z deską, czerwony (#ff4444), wypalone „NN"** — nic wspólnego z naszymi
krzyżami/płytami/obeliskami; karta „NN — ENEMY / buried without a name / sektor";
nagłówek liczy osobno („N brought home and buried · M of theirs, no name").

### 2. Wróg wyrzuca ciało tylko wolnym — `ship.js`
`_aiFreeHand(near)`: ta sama reguła co `pickBest` w combat AI — IDLE, nie w kokpicie,
nie ostatni strzelec, nie niesie, nie wysłany. AI wyznacza go wprost (`_rescueId`), na
wrogim kadłubie martwego podnosi **tylko wysłany** (strzelec obok zostaje przy dziale);
ogólny dispatch „eject" działa już tylko dla gracza. Brak wolnego — ciało leży i gnije.

### 3. Łatanie dziur raz, nie do kwadratu — `crew.js`
`breach.repair(dt × breachFactor, this)`; `HullBreach.repair` mnoży przez
`breachSpeed()` sam. Mistrz łata 2,5× szybciej, nie 6,25×. (XP za łatanie też liczone
od czasu, nie od przyspieszonego czasu.)

### 4. Abordażyści się rozchodzą — `crew.js`
Moduł, w którym kolega już stoi albo do którego idzie, ląduje na końcu listy celów —
dwóch nie idzie gęsiego do jednego modułu (to był „jeden stoi w pustym pokoju, drugi
atakuje").

### 5. Po walce zostajesz przy statku — `game.js`
`_leaveFight()` = `STATE = 'map'` + `_mapView = 'ship'` na każdym wyjściu z walki
(JUMP po zwycięstwie, nasza ucieczka, ucieczka wroga, kapitulacja, koniec wraku).
Mapę otwiera gracz (M / SHOW MAP).

### 6. Terra i pipsy — `systems.js`, `ship.js`, `renderer.js`
- `hasCyborg` = **operator przy konsoli** (`consoleCrew`, slot 0), nie „ktoś w pokoju".
  +1 włącza się, gdy stanie przy konsoli, gaśnie, gdy z niej zejdzie
- **jego jednostka odchodzi z nim**: z pełnego modułu (gdzie zastępował jednostkę
  reaktora) moduł traci 1 (`desiredPower − 1`) — dawniej moduł dobierał z banku, a
  reaktor, do którego szedł, dostawał +1 (dwie jednostki z jednego człowieka)
- pipsy modułu: pomarańczowe = jednostki z reaktora (`reactorDraw`), **jego zawsze
  błękitna** — pełny moduł i moduł o jeden krótszy wyglądają tak samo (bo to ten sam
  stan); stary dodatkowy błękitny pips nad stosem skasowany
- pipsy reaktora od dołu: własne jednostki (lit / winda niebieska / ciemne), jednostka
  Terry (błękitna), **nebula fioletowa** (#8a3fbf), uszkodzone czerwone — czerwony
  pips nie znika, gdy Terra staje do naprawy (premia nie jest już wliczona w „rated")

### 7. Zaraza przez kanały — `ship.js`
Przy działającym O2: BFS po `ductLinks` od pokoju z gnijącym ciałem; szansa/s
`Ship.PLAGUE_VENT_RATES` = 0,03 (sąsiedni kanał) / 0,02 (dwa) / 0,012 (dalej);
pokój z ciałem 0,05 jak dotąd; poza zasięgiem kanałów stare 0,008. O2 wyłączone —
tylko pokój z ciałem.

### 8. Apteczki 5 dawek / 30 CC — `cargo.js`, `station.js`, `ui.js`
`medkit.stackMax` 10 → 5 (cena dawki bez zmian, 6 CC); wróg ma 2–4 pudełka (10–20 dawek).

### 9. Imiona — `crew.js`, `game.js`, `base.js`, `station.js`, `wreck.js`
Pula 32 → 96 imion; **każde** losowanie (konstruktor, załoga wroga, rekrut w bazie i w
porcie, rozbitek) idzie przez `pickUniqueName` przeciw `CrewMember.namesInPlay()` —
game.js podpina: nasz kadłub + ich kadłub + `Base.takenNames()`. `RECRUIT_NAMES` skasowane.

### 10. Winda i reaktor wroga — `ship.js`, `combat.js`
- **na wrogim kadłubie windy biorą prąd pierwsze** (`liftFirst`), moduły płacą resztą —
  winda staje dopiero przy całym zbitym reaktorze (propozycja jj)
- AI naprawia **reaktor pierwszy** (potem silniki w Zero-G, potem reszta)

### 11. Boss — `boss.js`
`BossManager._seatCommander()` w każdym `_buildPhaseShip`: zawsze dowódca (poziom 6+sektor,
2 chipy), **ten sam przez wszystkie fazy** (`captain`, kasowany w `reset`); 4 pudełka apteczek.
(Wcześniej `_startCombat` obiecywał dowódcę bossa, ale boss nigdy przez niego nie startuje.)

### 12. Cloak wroga — `combat.js`
Odpala tylko, gdy jest gotowy **i w powietrzu leci nasz pocisk** (wcześniej także przy
kadłubie < 66% bez niczego w powietrzu — marnował cooldown).

### 13. Testy
Sekcja **278**; poprawione stare: 43 (pudełka po 5), 273/275 (Terra przy
konsoli, `stationSlot(…, 0)`), 276 (wróg z windami 10/10), 277 (wolna ręka, NN, bay bez
Terry wroga, rozmiar po posadzeniu jeńców), 22 (cloak: „ranny raider czeka, dopóki nic nie leci").
smoke krok 85 (NN na wzgórzu). run_tests **5527**, smoke **85**, browser **90**.
Znany losowy test sprzed 93a (nie ruszany): „every pup is fed differently" — raz na ~8
przebiegów dwa szczeniaki mają 90.

`break_check.js`: **30 rewertów `#93a`** + 9 przekotwiczonych (`#6`, `#65`×2, `#90`,
`#91`×2, `#93`×3). Razem **953 wpisy, 0 złych kotwic**. Pierwszy przebieg 28/30 (test
rozejścia abordażystów patrzył na stan po 30 s, kiedy i tak się rozchodzili — teraz
pierwszy wybór; test kapitana bossa był warunkowy na liczbę faz — teraz bezwarunkowy).
Drugi i trzeci przebieg złapały jeszcze trzy testy zależne od losu (imiona wroga — za
mało losowań; windy wroga — Terra przy konsoli albo pusta wnęka dawała zapas; rekruci w
porcie — za mało portów): wzmocnione (więcej losowań, ustawiony stan bez zapasu).
Czwarty przebieg na ostatecznym drzewie: **30/30**; 9 przekotwiczonych: 9/9.

### 14. Do decyzji / dalej
- **93b — lutowanie wraku po zniszczeniu** (pomysł jj): szczątki/skrzynie zamiast okna
  cargo, wyprawa w próżnię, Pegasus najlepszy
- 94 bunkry i mech
- obrazków z wiadomości jj (abordażysta w pustym pokoju, zamrożony przy windzie) nie było
  — poprawki zrobione z opisu

## 5-0g. ZMIANY update93 (WRÓG NA TYCH SAMYCH ZASADACH)

Punkty gracza 18, 19, 20, 27, 29 z listy 30.09 (`claude/ustalenia-2026-09-30-lista-29-punktow.md`)
+ AI ciepła z planu dema. Zasada: **wróg dostaje tylko ROZKAZY**, które gracz
daje z menu ciała — kto idzie, kto klęka, która śluza się otwiera, ile dawek
schodzi i ile to trwa, liczą te same linijki co u nas.

### 1. Apteczki i ciała wroga — `ship.js` (`_aiBodyOrders`, wołane z `_updateBodies`)
- ich leżący: `bodyOrder = 'medkit'`, gdy kadłub ma ≥ `MEDKIT_DOSES` i **nie ma
  zapalonego medbaya** (zapalony — dispatch i tak go tam niesie); pusta skrzynka
  → rozkaz cofnięty (inaczej medyk stałby nad nim na zawsze)
- ich martwy: `bodyOrder = 'eject'` po `Ship.AI_VENT_SECONDS` (8 s, liczone
  `_rotT`) albo gdy gnije; kadłub bez śluzy — bez rozkazu
- nie dla gracza, nie na wraku, nie dla jeńców, kota i zamrożonych
- sekcja 8 przepisana: wrogi medyk stawia rannego medkitem (2 dawki), nie bandażem

### 2. Ich ciała na NASZYM pokładzie — `game.js`, `ship.js`, `base.js`
- `_bodyUnderCursor` znajduje martwego wroga (żywego nadal nie); menu EJECT / BAG
- podnoszenie: `bodiesInRoom(…, false)` + filtr: nasi albo martwy z rozkazem `eject`
- EJECT: **bez karmy** (`EJECT_KARMA` tylko za naszego), komunikat „An enemy body…"
- BAG: worek `meta: { name: 'Unknown', enemyBody: true, bounty: 0 }`; w bazie
  `report.buriedUnknown`, **+1 karmy** (`Ship.UNKNOWN_BURIAL_KARMA`), 0 CC, nic na
  cmentarzu (decyzja asystenta — do potwierdzenia przez jj)
- gniją i zarażają jak dotąd (to już działało); komunikat mówi, że to ciało wroga

### 3. Ucieczka po 60 s bez obrażeń — `combat.js`, `ship.js`, `crew.js`
- jeden licznik `Ship.noteHarmToPlayer()` / `Ship.harmToPlayer()`: trafienie, które
  doszło do kadłuba gracza i coś zrobiło (kadłub, poziom modułu, ludzie w pokoju —
  nie pudło, nie osłona, nie sam ion) oraz cios ich człowieka w naszego
- `Combat._noHarmT` rośnie, zmiana licznika zeruje; `STALEMATE_SECONDS = 60` →
  ta sama ucieczka co przy kadłubie (11 s, pasek, zbicie kokpitu/silników),
  `escapeWhy = 'stalemate'`, osobny komunikat „ENEMY GIVES UP…"
- nigdy boss, nigdy wrak; zegar stoi przy ofercie kapitulacji

### 4. Jeńcy wroga w karbonicie — `ship.js`, `game.js`
- `_slabIn(c)` — jeden kod zamrażania dla rozkazu gracza i dla jeńców wroga;
  `freezeCaptive(c)` przy `_seatCaptives` (pojemność liczona z poziomów zbudowanych,
  bo prąd jeszcze nie popłynął)
- rozmrażanie regułą `carboniteTick` (LIFO): brak prądu, zbity poziom, abordażysta
  sabotujący zatoczkę → jeniec wychodzi do pokoju; komunikat dla gracza
- `freeCaptives` nie bierze zamrożonych — **najpierw trzeba zbić zatoczkę**
  (działem albo abordażystą, który sam sabotuje moduł, w którym stoi)

### 5. Walka wręcz w parach — `crew.js`
- `duelSpot(ship, foes)`: to samo parowanie co `meleeTarget` (po id); P = mniejsza
  strona; para p dostaje równy pas pokoju (margines `MELEE_INSET`), **nasi z lewej,
  ich z prawej**, odstęp ±9 px; nadwyżkowi stoją krok (7 px) za kolegą z pary
- wejście w pozycję 40 px/s (`DUEL_GLIDE`), `_duel` kasowane co klatkę poza walką
- pod parą krótka złota linia z kropką (rysuje pierwszy nasz z pary)

### 6. AI ciepła — `ship.js` (`coolingAI`, `REACTOR_HEAT_CONFIG.ai`), `combat.js`
- od 75° co 1 s zdejmuje 1 jednostkę aż obciążenie (z `desiredPower`) ≤ 70%;
  kolejność: medbay → cloak (nie aktywny) → autonaprawa → silniki >1 → broń
  (nigdy ostatnia zasilona) → osłony >2 → O2 >1; nigdy reaktor, kokpit, karbonit
- od 30° oddaje po jednej, ostatnio zabraną pierwszą (`_aiShed`)
- wołane z `Combat._updateAI` co klatkę. Uwaga: nie każdy wrogi kadłub grzeje się
  (obciążenie 50–89% zależnie od układu) — to stan sprzed 93

### 7. Testy
Sekcja **277** (82 asercje) + przepisana sekcja 8; smoke_draw krok 84 (pary, jeniec
w płycie, menu nad martwym wrogiem). run_tests **5490**, smoke **84**, browser **90**;
10/10 zielonych pod rząd. Przy pisaniu złapane dwa słabe testy: „żywy wróg się nie
klika" sprawdzany w pokoju, gdzie leżał martwy (kursor trafiał w trupa), i próg 75°
czytany z konfigu (rewert konfigu przesuwał też test).

`break_check.js`: **48 rewertów `#93`** + 4 stare przekotwiczone (`#65` worek i karma,
`#72` uwolnienie, `#72` kursor). Razem **923 wpisy, 0 złych kotwic**. Pierwszy przebieg
46/48 (dwa słabe testy wyżej, poprawione); drugi 47/48 — „AI zdejmuje ostatnie działo"
łapane tylko, gdy wylosowany kadłub doszedł do broni; dopisany test na zbudowanym rogu
(wszystko na minimum, jedno działo zasilone). Trzeci przebieg na ostatecznym drzewie: **48/48**.

### 8. Do decyzji jj
- worek z wrogiem: +1 karmy i nic na cmentarzu — czy ma być nagrobek „NN"?
- wróg wyrzuca swoich po 8 s — czy wolniej (dziś ciało szybko znika z jego pokładu)
- ucieczka po 60 s także gdy wróg nie ma już broni — to właśnie ten przypadek
- stare: łatanie dziur do kwadratu; noszenie 50% w grawitacji

## 5-0h. ZMIANY update92 (GRZANIE REAKTORA)

Spec GPT (plik jj z 01.10) z łagodniejszymi liczbami jj. Decyzje: te same
zasady w walce i poza nią; grzanie od 80% obciążenia (10 / 6 / 3 min do
pełna), chłodzenie od 30% wolnego; **windy nie liczą się do obciążenia**
(jj, 01.10 23:40 — inaczej domyślny rozdział siedział na 100% od startu).

### 1. Model — `ship.js` (`REACTOR_HEAT_CONFIG` na górze pliku)
- `Ship.reactorHeat` 0–100 (stan, zapisywany); `reactorLoad` = suma
  `reactorDraw()` modułów / `reactor.totalPower` (windy poza tym)
- `reactorHeatRate()` (% na sekundę): obciążenie ≥100% → 100/180,
  ≥90% → 100/360, ≥80% → 100/600 (× mnożnik termiczny wg poziomu reaktora:
  ≤8 1,00, ≤12 0,95, ≤16 0,90, wyżej 0,85); inaczej wolne ≥50% → −100/150,
  ≥40% → −100/300, ≥30% → −100/600; między (71–79% obciążenia) trzyma.
  SCRAM albo reaktor bez mocy → −100/150. Linie się nie nakładają:
  80% obciążenia = 20% wolnego
- `_heatTick(dt)` co klatkę po przepływie prądu (i po grawitacji), na
  mapie i w walce. **Przegrzanie** przy 100: `damageLevel(1)` na reactorze,
  ciepło 90, 50% ognia w pokoju reaktora, komunikat, wybuch, wstrząs;
  potem nadmiar prądu odbiera przepływ (od ostatnio zasilonego, 90a).
  **Ryzyko ognia** co 1 s (pętla na czasie): ≥90 2%, ≥80 0,5%, ≥70 0,1% —
  tylko pokój reaktora; od 70 iskry w pokoju (1/2/3 na sekundę)
- komunikaty (tylko gracz) przy przekroczeniu 70 i 90 w górę, raz;
  dźwięki `reactorWarn / reactorCritical / reactorOverheat`
- reaktor naprawia załoga jak każdy moduł; sam się nie naprawia (moduł
  autonaprawy, jeśli gracz go kupił, działa jak dotąd)
- zapis: `serialise` pisze `heat`, stary zapis = 0; **powrót do bazy
  zeruje** (`Base.returnFromRun`)
- wróg: ta sama symulacja, bez komunikatów. Rozmiarowany wróg ma reaktor
  = moduły + windy, więc siedzi na ~90% i się grzeje (~6 min do pełna).
  AI chłodzenia — w 93

### 2. Widać — `renderer.js`, `ship.js`
Pionowy pasek ciepła (5 px) na prawo od pipsów reaktora, od dołu, wysoki jak
stos; kolor i puls: <70 niebieski, 70 żółty, 80 pomarańczowy, 90 czerwony
(szybki puls); kreski na 70 i 90; liczba „NN°" nad paskiem; przy
przegrzaniu „REACTOR OVERHEAT" przez 2,5 s. U wroga „HOT NN°" pod
reaktorem od 80. Karta reaktora: ciepło, obciążenie, trend.

### 3. Testy
Sekcja **276**: obciążenie bez wind (fregata 7/8); pasma grzania i
chłodzenia na reaktorze 10 (+ 75% trzyma, 70% chłodzi wolno, 33% wolnego
wolno, SCRAM szybko); mnożniki 1,00/0,95/0,90/0,85; 3 min na 100% dochodzi
do przegrzania, 160 s bez prądu do zera, nigdy >100; przegrzanie: dokładnie
1 poziom, ciepło 90, raz, nie co klatkę, moduły nie ciągną więcej niż jest,
ogień przy rzucie <50% w pokoju reaktora; naprawa przez załogę, bez załogi
nie; rzut ognia raz na sekundę przy dt 0,05 i 0,5, tylko pokój reaktora,
progi 0,1/0,5/2%; komunikaty raz; wróg grzeje się bez komunikatów;
rozmiarowany wróg się grzeje; zapis/odczyt/stary zapis/baza; pasek 93%
czerwony, liczba, OVERHEAT, karta, HOT u wroga.

Test niestabilny złapany od razu: załogant bez rasy bywał Terrą (+1 do
reaktora przy konsoli); rasa ustawiona. 10/10 zielonych pod rząd.

`break_check.js`: **27 rewertów `#92`**. Razem **875 wpisów, 0 złych
kotwic**. Pierwszy przebieg 27/28: przeciekł „ciepło ponad 100" — i słusznie
nie da się go złapać: każde ≥100 w tej samej klatce przegrzewa reaktor
i wraca do 90, więc górne obcięcie jest tylko asekuracją. Rewert usunięty.
Drugi przebieg na ostatecznym drzewie: **27/27**.

**Dalej:** 93 wróg na tych samych zasadach (+ AI ciepła: zdejmowanie prądu
przy wysokim cieple) → 94 bunkry i mech.

## 5-0i. ZMIANY update91 (GRAWITACJA POD SILNIKAMI, KOT GŁODNY NA START)

Decyzje jj z 01.10 wieczór: **zapis gry odpada** (demo i tak nie będzie w
przeglądarce), więc numeracja się przesuwa: 91 = grawitacja (dawne 92),
92 = grzanie reaktora, 93 = wróg, 94 = bunkry i mech. Spec grawitacji: GPT,
plik jj z 01.10 (`claude/ustalenia-2026-10-01-plan-dema.md`). Jedna zmiana
względem spec: noszenie rannych w Zero-G **120%** (jj), nie 80%. Utrata
ładunku: **dziura gdziekolwiek** (jj — ładownia nie ma przedziału).

### 1. Kot głodny na start — `crew.js`, `game.js`
`CAT_TUNING.START_HUNGER = 60` (poluje: < `HUNGER.FED` 80; nie idzie jeść:
> `HUNGRY` 40). `makeCat` daje 60; przy starcie kontraktu kot z bazy ma
`min(głód, 60)` — zawsze wchodzi na pokład głodny.

### 2. Grawitacja — `ship.js` (`GRAVITY_CONFIG` na górze pliku)
- **nic nie jest zapisywane**: `Ship.gravityActive` = silniki istnieją,
  ≥1 sprawny poziom, `effectivePower() ≥ 1` (cyborg Terra przy konsoli
  silników trzyma grawitację sam — jak ikona z 90a; ion = Zero-G).
  `Ship.zeroG` = negacja
- `_gravityTick(dt)` co klatkę po przepływie prądu: ustawia `c._zeroG`,
  przy **zmianie** (nie co klatkę) komunikat GRAVITY LOST / RESTORED
  (tylko gracz), dźwięk `Audio.sfx.gravityOff/On`, lekki wstrząs przy
  powrocie; pierwsza klatka tylko zapamiętuje (start w Zero-G to nie
  „utrata"). Zegar ładunku zerowany przy każdej zmianie
- `moveFactor(c)`: Zero-G 0,70; niesie kogoś: 0,50 w grawitacji / **1,20**
  w Zero-G (zamiast, nie razy). Dotyczy też ciał i rozbitka. Uwaga: noszenie
  w grawitacji jest teraz **wolniejsze niż dawniej** (było 100%)
- `repairFactor()` 0,80, `breachFactor()` 0,70 — mnożone **w miejscu użycia**
  (`crew._updateTask`), nie w `repairSpeed/breachSpeed`
- `_zeroGCargoTick`: co 20 s 15% → jeden przedmiot `damaged` (istniejący
  stan: 40% wartości, nie da się rozpakować; **jaj nie**, bo uszkodzone jajo
  się nie wykluwa); przy **dowolnej niezałatanej dziurze** co 10 s 25% →
  jedna sztuka ze stosu albo cały przedmiot, „CARGO LOST: X". Pętla `while`
  na czasie — niezależne od FPS. Wróg ma te same zegary (bez komunikatów)

### 3. Ogień — `fire.js`, `particles.js`
`fire.zeroG` ustawiane co klatkę (stan wizualny tego samego obiektu);
szansa rozprzestrzenienia × 0,20. W Zero-G rysowana kula (pulsujący
gradient) i `Particles.fireParticlesZeroG` (żar dryfuje na boki, bez
dymu w górę). Tlen gasi jak dawniej (Zero-G ≠ próżnia).

### 4. Widać — `ship.js`, `renderer.js`
- pod ikoną silników: „GRAV ON" (cicho) / „⚠ ZERO-G" (pulsuje); u wroga
  „0-G" tylko gdy ją straci; wiersz w karcie silników
- załoga unosi się (`Ship.floatOffset`, tylko rysowanie — x/y bez zmian;
  kabina windy i kot w kanale bez), drobinki w powietrzu przedziałów
  (`_drawZeroGMotes`, kilka kropek na pokój, nic nie symulowane)

### 5. AI wroga — `combat.js`
W Zero-G silniki idą na początek listy napraw (pierwszy wybór wolnej ręki);
nic nie jest wymuszane.

### 6. Poprawka przy okazji: log nie zasłania paska wroga — `renderer.js`, `ui.js`
Zrzut pokazał okno logu (88) narysowane na pasku modułów wroga, gdy wrogi
kadłub stoi nisko. `Renderer.enemyStripBottom()` (liczone co klatkę w
`_drawEnemyModules`); `UI.logRect()` zaczyna okno pod nim (traci linie,
min. 60 px).

### 7. Znalezione, NIE zmienione
`HullBreach.repair` mnoży przez `crew.breachSpeed()`, a `crew._updateTask`
podaje już `dt * breachSpeed()` — umiejętność łatania liczy się do kwadratu
(jak kiedyś naprawa, poprawiona w starszej paczce). Zostawione: zmiana
balansu, do decyzji jj.

### 8. Testy
Sekcja **275**: kiedy jest grawitacja (moc, uszkodzenia, częściowe
uszkodzenia, naprawa, ion, cyborg, brak silników); komunikat raz, nie dla
wroga, nie na starcie; trafienie w reaktor zabiera ostatnią jednostkę
silników → Zero-G; chód 70%, noszenie 50/120% (mierzone w px/s); naprawa
80%, łatanie 70%; ogień: ten sam rzut szerzy w grawitacji, nie w Zero-G,
pali dalej, gaśnie bez tlenu, kula/stary płomień; ładunek: nic przed 20 s,
1 przy 20 s, jajo nigdy, 60 s = 3 przy dt 0,05 i 0,5, grawitacja zatrzymuje;
utrata: sam Zero-G nie, sama dziura nie, oba — 1 sztuka po 10 s ze stosu,
pojedynczy przedmiot cały, zainstalowana broń nie, załatane / grawitacja
wraca — stop; AI wroga idzie do silników; GRAV ON / ⚠ ZERO-G / 0-G / karta;
unoszenie bez ruchu; log pod paskiem wroga; kot z bazy (głód 100) wchodzi
na 60.

`break_check.js`: **33 rewerty `#91`** + przestawiona kotwica `#90a the map
log covers the map` (logRect przepisany). Razem **848 wpisów, 0 złych kotwic**.
Pierwszy przebieg: 4 przecieki, wszystkie słabe testy — wróg w teście
startował już w Zero-G (nie było czego ogłaszać), zerowanie zegarów przy
zmianie nie było sprawdzane, losowanie nie trafiało w jajo, a na fregacie
wroga silniki i tak są pierwsze na liście napraw (test przeniesiony na
rajdera, który ma broń przed silnikami). Dwa przebiegi końcowe: **33/33
i 33/33**, kotwica mapy 1/1.

**Pułapka narzędziowa (nowa):** `(cd $S/kopia && …) & (…) &` w jednym
poleceniu — zmienna ustawiona w pierwszym podpowłoce nie istnieje w drugim,
`cd` na pustą ścieżkę zawodzi, a polecenie po `;` uruchamia się w katalogu
roboczym. Raz się tak stało (jeden rewert, plik przywrócony, drzewo
sprawdzone diffem). break_check uruchamiać skryptem, który sam sprawdza,
że nie stoi w repo.

**Dalej:** 92 grzanie reaktora → 93 wróg na tych samych zasadach →
94 bunkry i mech.

## 5-0j. ZMIANY update90b (POPRAWKI Z GRANIA 90 + KOT, ODSZCZURZANIE, ROZBITEK)

Decyzje jj z 01.10 wieczór (`claude/ustalenia-2026-10-01-plan-dema.md`, pkt 1b).

### 1. Uszkodzona winda też staje — `elevator.js`
`update`: kabina w ruchu stoi, gdy `powered === false` **albo `damaged`**.
Pasażer czeka w środku; po naprawie (i z prądem) jedzie dalej. Zabezpieczenia
z 90 w `crew._updateMovement` (`!this._ridingShaft && !this._elevatorArrived`)
działają teraz w jednym przypadku: winda gaśnie dokładnie w klatce, w której
kabina wypuściła pasażera — jest na to test.

### 2. Abordażysta wroga nie utyka — `crew.js`
Gdy nie ma czego psuć w swoim module: co 1 s (`_roamCd`) wybiera z **każdego**
modułu oprócz reaktora (najpierw broń, tarcze, ster, silniki, tlen) pierwszy
**osiągalny** (`moveToOnShip` zwraca true); gdy żaden — idzie do najbliższego
obrońcy. Dawniej: jeden cel z pięciu typów, a gdy był nieosiągalny (np. winda
ciemna od 90) — stał. Błędu jj nie odtworzyłem 1:1; to dwa miejsca, gdzie mógł
utknąć.

### 3. Brak dowódcy na wraku — `game.js`, `renderer.js`
`_startWreckBoarding` czyści `Commander.setEnemy(null)` (dowódca z walki
zakończonej ucieczką zostawał), a znaczek nie rysuje się nad `isDerelict`.

### 4. Mgławica kończy się z wygraną — `game.js`
`_onWin` zeruje `reactor.penalty` i `_nebulaCombat` (dawniej dopiero przy
wyjściu z ekranu walki).

### 5. Kot — `crew.js` (HUNGER.PREY), `ship.js`
- `Ship.preyFood(p)`: szczur poz. 1/2/3 = **5/15/30**, pająk **20** (głód +,
  HP trochę); dawniej każdy szczur 45
- **najedzony kot (głód ≥ `HUNGER.FED` 80) nie poluje**: nie idzie do szkodnika
  (`petTick`) i nie wchodzi z nim do kanału (`_pestVsCat`). Świeży kot ma 100,
  więc zaczyna polować po kilku minutach. Stare testy kota dostały kota
  głodnego (60)

### 6. Odszczurzanie w porcie — `station.js`, `ui.js`
`Station.offersFumigation` (ogólny i naukowy, nie czarny rynek),
`fumigationCost(ship)` = **40 + 5 za szczura/pająka** w kanałach,
`fumigate(ship, run)` usuwa wszystkie szkodniki (kot puszczony), **jaja w
ładowni zostają**. Karta „DUCT FUMIGATION" w zakładce napraw, gdy są
szkodniki; w innych portach mówi, gdzie to zrobić.

### 7. Rozbitek na wraku — `wreck.js`, `game.js`, `ship.js`
- `WRECK_SURVIVOR_SHARE = 0.10`; `makeSurvivor()`: nasz, ranny, zabandażowany
  (nie wykrwawia się), **jedna umiejętność 3/3** (specjalizacja) + druga 1–2;
  `placeSurvivor(ship, avoidId)` — nie w pokoju dokowania
- `_enemyShip.dockRoomId` = pokój wraku przy śluzie, przez którą wchodzimy
  (ta sama reguła co `_makeParty`)
- `_survivorTick` (w walce, tryb wraku): nasz człowiek z wolnymi rękami w jego
  pokoju **podnosi go sam**; doniesiony do `dockRoomId` → `_rescueSurvivor`:
  przechodzi na nasz statek do pokoju przy śluzie, ranny, w załodze — dalej
  zwykła akcja ratunkowa do medbaya
- **wrak czeka**, dopóki ktoś go niesie (`_survivorCarried`), nawet gdy
  wszystko przeszukane. Przy `_recoverBoarders`: niesiony → wraca z nami;
  niepodniesiony → zostaje na wraku (komunikat)
- pętla noszenia w `ship.js` nie prowadzi rozbitka do medbaya wraku
- nad nim napis **SOS** (pulsuje) / „SURVIVOR → HATCH" gdy niesiony
- **nie jest nasz, dopóki nie wejdzie na pokład**: poza listą załogi
  (`crewRoster`), poza zaznaczaniem ramką i poza `_playerCrewAliveCount`
  (inaczej ranny rozbitek na wraku trzymałby przy życiu przegraną wyprawę).
  Znalezione na zrzucie ekranu

### 8. Wrak nie „ucieka" — `combat.js`
Kadłub wraku jest zawsze poniżej 45%, więc wrak rzucał na ucieczkę jak pokonany
statek i nad hulkiem pojawiało się „FTL SPOOLING" (martwy kokpit nie pozwalał
mu odlecieć, ale ostrzeżenie kłamało; od 90a wrak ma też działający poziom
silników). Rzut na ucieczkę pomija `isDerelict`. Znalezione na zrzucie ekranu.

### 9. Testy
Sekcja **274**: abordażysta (moduł w ładowni, cel za ciemną windą → następny,
nic do psucia → obrońca), dowódca nad wrakiem, mgławica przez `_startCombat`
/ `_onWin`, punkty ofiar, kot syty/głodny (+30 za dorosłego), odszczurzanie
(typy portów, cena, za mało CC, jaja zostają, **przycisk w DOM stacji**),
rozbitek (fabryka, rzut 10% przez prawdziwe `_startWreckBoarding`, nie w pokoju
dokowania, podniesienie, wrak czeka, przekazanie przez `_updateCombat`,
zostawiony). 273 §7b przepisane (uszkodzona winda staje i rusza po naprawie)
+ nowy przypadek „gaśnie w klatce przyjazdu".

Testy zależne od losu (rozbitek na 10% wraków): pomocnik `searchHulk` zdejmuje
rozbitka (jego przeszukiwacz podnosiłby go, a wrak czekałby na doniesienie);
testy 274 zdejmują losowego przed postawieniem własnego i dają mu imię spoza
listy imion (zbieg imion z załogą dawał fałszywy fail). 12/12 zielonych
przebiegów pod rząd.

`break_check.js`: **28 rewertów `#90b`** + przestawiona kotwica `#90a a dark
lift carries on`. Razem **815 wpisów, 0 złych kotwic**. Przecieki po drodze
(każdy zatkany testem):
- „nic do psucia → obrońca" — obrońca w teście sam łatał tarcze i dawał
  abordażyście cel; moduły trzymane zepsute co klatkę
- „rozbitek do medbaya wraku" — żaden obecny wrak nie ma medbaya (test na
  wraku z fregaty), a niosący w 10 s nie zdążał wyjść z pokoju (test patrzy
  też, czy nie ma trasy)
- „syty kot dalej poluje" — w teście kot stał pod szczurem; dodany szczur
  w innym pokoju
- „wrak rzuca na ucieczkę" — w teście najpierw wypadało poddanie się;
  `surrenderOdds` wyłączone na czas testu

Dwa przebiegi końcowe na ostatecznym drzewie: **#90b 28/28 i 28/28**,
`#90a a dark lift carries on` 1/1, `#90 a ride under way…` 1/1,
`#90 the arrival from a dark lift…` 1/1.

**Dalej:** 91 zapis → 92 grawitacja → 93 grzanie reaktora → 94 wróg →
95 bunkry i mech.

## 5-0k. ZMIANY update90a (POPRAWKI Z GRANIA 87–90)

Uwagi jj z 01.10 (lista w `claude/ustalenia-2026-10-01-plan-dema.md`, pkt 1).
Bez nowych mechanik; grawitacja i grzanie reaktora to 92 i 93.

### 1. Jednostka Terry odchodzi razem z nim — `ship.js`
Błąd: cyborg przy reaktorze daje 9. jednostkę, gracz oddaje ją np. silnikom,
cyborg odchodzi — silniki ją ZACHOWYWAŁY, a jednostkę tracił moduł z końca
listy (tlen). Przepływ prądu w `Ship.update` przepisany: każdy moduł prosi
o `desiredPower`; gdy reaktor nie wystarcza, jednostki wraca moduł **ostatnio
zasilony** (`sys._powerStamp`, ustawiany w `setPowerAt` przy podniesieniu),
potem od końca listy (stary porządek). Dotyczy też trafienia w reaktor.
Gdy cyborg wraca, prąd wraca sam (`desiredPower` zostaje).

### 2. Kolory ikon na paskach — `renderer.js`
`Renderer.moduleIconState(sys)`: **broken** (0 sprawnych poziomów lub ion) =
czerwony, **running** (efektywna moc > 0, +1 cyborga się liczy) =
pomarańczowy, **off** = szary. Ten sam stan na pasku gracza i na pasku wroga.
Dotąd „bez prądu" było czerwone jak zepsute, a moduł na samym cyborgu szary.

### 3. „Miganie" statku wroga — `ship.js`
Przyczyna: maskowanie (cloak) rysowało cały kadłub z przezroczystością
pulsującą 0,43–0,67 co ~1,5 s, a mówił o tym tylko komunikat. Teraz stałe
`Ship.CLOAK_ALPHA = 0.45`, fioletowy przerywany obrys i napis **CLOAKED Ns**
nad kadłubem. (Jeśli jj zobaczy miganie BEZ napisu — to inna przyczyna.)

### 4. Kapsuła ratunkowa jako znaczek — `game.js`
`_podRect()` = kwadrat obok paska dowódcy (`commanderStripRect`), nie przycisk
na środku na linii JUMP. `_podState()`: live / dark (chip jest, ale karma go
zgasiła) / none. Hover mówi co i ile (`Commander.KARMA.EVACUATE`). W trakcie
odliczania: czerwony, opada od góry, obok „POD Ns". Rysowany w walce.

### 5. UI
- **bez nazw modułów w pokojach** (`ShipSystem.draw`) — nazwa jest w tytule
  karty hovera
- **hover tylko nad znaczkiem** modułu: `ShipSystem.badgeRect()` (ten sam
  prostokąt rysuje znaczek i łapie mysz w `UI.moduleUnderMouse`)
- **brak komunikatów na środku** tam, gdzie jest okno logu: walka **i mapa**
  (`logPanel`). Na mapie sektora okno niższe (`LOG_RECT_COMPACT`, y 606–688,
  pod panelem mapy). Zamknięte okno liczy nowe wpisy („LOG ▴ 3 new").
  Klawisz L i klik w zakładkę działają też na mapie. Baza/menu bez okna —
  tam pop-upy zostają

### 6. Jedzenie = tylko jedzenie — `crew.js`
`_updateMovement` nic nie robi, gdy `_busyAct === 'eat'`: stoi, trasa zostaje,
rusza po posiłku. (Pracy przy jedzeniu nie było już od 81.) Bójka dalej ma
pierwszeństwo.

### 7. Winda bez prądu staje — `elevator.js`, `crew.js`
Cofnięta decyzja z 90: kabina bez prądu **staje w miejscu, także między
pokładami**; pasażer siedzi w środku do powrotu prądu, potem kabina jedzie
dalej. `moveCabinTo` bez prądu zawsze odmawia; `moveToOnShip` w trakcie jazdy
planuje „zawrócenie" tylko gdy `moveCabinTo` się udało, inaczej rozkaz czeka
(`_rerouteAfterRide`). Stojąca kabina: ⚡ OFF zamiast strzałki.

### 8. Wraki — `wreck.js`, `ship.js`
Pół reaktora (`floor(capacity/2)` poziomów uszkodzonych, do naprawy), O2
1 poziom zasilony, **silniki 1 poziom zasilony** (pod grawitację w 92), reszta
zestrzelona. Windy **bez wyjątku** dla wraku — z resztki, od lewej.

### 9. Kontrabanda w porcie — `station.js`, `game.js`
`Station.customs(ship, run)` przy wejściu do portu (`_customs` w gałęzi
`store`): każdy typ **oprócz outpostu** (czarny rynek też jest outpostem)
zabiera całą kontrabandę i **100 CC kary** (`CUSTOMS_FINE`). Brak CC → towar
z ładowni po cenach tego portu: najtańszy pojedynczy przedmiot pokrywający
resztę, inaczej najdroższy i dalej. Komunikaty do logu. Podpowiedź w ładowni
zmieniona.

### 10. Testy
Sekcja **273** (62 asercje): Terra — jednostka wraca z modułu, któremu ją dano,
i wraca, gdy on wraca; trafienie w reaktor zabiera ostatnio zasilonemu;
stany ikon + liczba czerwonych pierścieni przez `drawHUD`; cloak bez pulsu
(alfa przy kilku `performance.now`) i z napisem; znaczek kapsuły
(położenie, none/live, odliczanie, bez dowódcy nic); log na mapie przez
`T._draw` (okno niższe, zamknięte liczy, L na mapie); jedzenie stoi i potem
idzie; kabina stojąca między pokładami ma OFF; cło w każdym typie portu,
outpost, brak kontrabandy, niedobór CC, pusta kiesa; **prawdziwy skok do
portu** przez `_travelTo`.

Przepisane: sekcja 96 (tabliczki → brak tabliczek), hangar (nazwa w liście,
nie na planie), 88 log (zamknięty nie wyskakuje, liczy), 88 hover (tylko
znaczek), 51/derelikt (pół reaktora, silniki 1), 272 #12 (kabina staje,
pasażer czeka, rozkaz czeka) i #13 (windy wraku po zwykłej zasadzie),
smoke kapsuły (hover), browser wraku (pół reaktora).

`break_check.js`: **22 rewerty `#90a`** + 12 przestawionych kotwic
(#73×2, #88×6, #90×4; te, które pilnowały zachowania usuniętego na prośbę jj,
pilnują teraz nowej zasady). Razem **787 wpisów, 0 złych kotwic**.

Pierwszy przebieg: 3 przecieki. „Niedobór zabiera najdroższe" — w teście
najtańszy wystarczający był zarazem najdroższy (teraz ration 40 / medkit 60).
Dwa stare #90 (przejazd przerwany, przyjazd zgubiony) — po 90a ciemna kabina
stoi, więc te zabezpieczenia działają już tylko przy windzie **uszkodzonej**
w trakcie jazdy (dalej jedzie); nowy test 273 §7b. Drugi przebieg:
**#90+#90a 55/55, #88 28/28, #73 22/22**.

**Dalej:** 91 zapis → 92 grawitacja → 93 grzanie reaktora → 94 wróg →
95 bunkry i mech (`claude/ustalenia-2026-10-01-plan-dema.md`).

## 5-0l. ZMIANY update90 (SIEĆ WENTYLACJI, WINDY NA WOLNYM PRĄDZIE)

Punkty 9 i 10 z listy z 30.09. Decyzje jj z 01.10: windy po **1 jednostce**,
pełny statek przez jedną śluzę pusty w **~2 min** przy wyłączonym O2,
**rezerwa dla wind** w domyślnym rozdziale (start i wróg), **na wraku windy
działają**, fregata: **lewa winda + broń 1/2**.

### 1. Kanały to jedna sieć (pkt 9) — `oxygen.js`

- `OxygenManager._ventNetwork(dt, ship)` — powietrze pełznie:
  - **kanał↔kanał** po `ship.ductLinks` (ten sam graf co szczury: bok nad
    drzwiami — zamkniętymi też — i góra/dół przez szyb), `VENT_LINK = 0.6`/s
    na różnicy poziomów kanałów; pary raz każda: `ventPairs(ship)` (cache
    `ship._ventPairs`);
  - **pokój→kanał** przez kratkę, `VENT_GRILLE = 0.15`/s, **tylko w górę**
    (pokój wyżej niż kanał). Powietrze schodzi do pokoju rurami (`_pipe`),
    więc reguły jj z 86b zostają: dziura bierze pokój przed kanałem,
    niedobór O2 najpierw w przedziałach;
  - **szyb windy→kanał**: komórka `shaft_*` oddaje powietrze do kanałów
    pokoi przy szybie (`ventShafts(ship)`, cache `ship._ventShafts`).
    Bez tego wyssany statek trzymał pełne szyby za zamkniętymi drzwiami
- sieć liczona **przed** dziurami w tej samej klatce → kanał nad otwartą
  śluzą jest suchy (powietrze przez niego przelatuje), szczur tam ginie
  jak w 86b. `DUCT_BLEED` 0,6 → **1,5** (to teraz ujście sieci)
- pokój otwarty w próżnię **nie jest „głodny"** — pompy go nie karmią
  (dotąd jego udział szedł w nicość)
- **„pusto" = poniżej `ROOM_EMPTY` (0,5%)** dla człowieka w pokoju
  (`breathable`) i szczura w kanale (`dry` w `_pestHazards`) — sieć opróżnia
  zbiornik asymptotycznie i inaczej nikt by się nie udusił

Liczby (pełny statek, jedna śluza, drzwi zamknięte, sim w Node):

| kadłub | O2 off, nikt → <10% | 3 ludzi, O2 2 | O2 3 | O2 4 |
|---|---|---|---|---|
| fregata | ~100 s | siada do ~33% | ~81% | ~83% |
| scout | ~76 s | ~48% | ~69% | ~75% |
| hauler | ~96 s | ~39% | ~77% | ~81% |
| boss_station | ~141 s | ~48% | ~81% | ~84% |

To **próg**, nie zbocze: albo maks. wyciek sieci przy pełnym statku bije
nadwyżkę pomp (statek siada), albo nie (trzyma blisko pełnego). LINK 0,4 —
dwa pipy O2 znowu trzymały; 0,5 na krawędzi; 0,6 dla zapasu.

### 2. Windy na wolnym prądzie (pkt 10) — `ship.js`, `elevator.js`, `crew.js`

- `Ship.LIFT_POWER = 1`; `_powerLifts(spare)` co klatkę w przepływie mocy
  (po modułach) — **od lewej** po `x`, niezależnie od kolejności listy.
  Reaktor SCRAM → wszystkie ciemne. **Wrak** (`isDerelict`) — zawsze zasilone
- `ElevatorShaft.powered`; `isUsable()` = nieuszkodzona **i** zasilona →
  `findPath` pomija, `board` odmawia, `moveCabinTo` odmawia bez pasażera
- **przejazd w toku dojeżdża**: `crew._updateMovement` czyści trasę tylko gdy
  nie jedzie i nie ma `_elevatorArrived` (stary błąd: po uszkodzeniu
  w trakcie jazdy flaga `_elevatorArrived` wisiała do następnej windy)
- **domyślny rozdział** `_defaultPowerPlan()`: O2, ster, tarcze do pełna →
  silniki 1 → **lewa winda** → każda broń 1 → broń, silniki do pełna →
  reszta wind → medbay, artyleria, reszta (`POWER_PRIO`). Fregata: O2 2,
  ster 1, tarcze 2, silniki 1, **broń 1/2**, 1 wolna = lewa winda, prawa
  ciemna. Scout: winda świeci, broń 1/2. Hauler bez zmian (miał 1 wolną)
- konstruktor rozdziela **drugi raz po zbudowaniu wind** (pierwszy był, zanim
  istniały — rezerwa w realnej grze by nie zadziałała)
- wróg: `sizeAirForCrew` dolicza `liftPowerNeed()` do reaktora → wszystko
  pełne i windy świecą
- **stare zapisy**: `serialise` pisze `lifts: 1`; zapis bez tego →
  `_reserveLiftPower()` raz przy wczytaniu: zwalnia tyle, ile domyślny plan
  trzyma dla wind, **najpierw z broni**, nigdy z O2/steru, silniki nie
  poniżej 1. Zapis po 90 zostaje jak gracz ustawił
- **widać**: ciemna winda — szare szyny/kabina bez światła, **⚡ OFF**; na
  pasku reaktora wolne pipsy, które biorą windy, są **niebieskie** (#4db8ff)

### 3. Testy

Sekcja **272** (64 asercje): śluza drenuje sąsiada za zamkniętymi drzwiami,
daleki pokój na górnym pokładzie i szyb; po 30 s większość jest; 2 pipy nie
nadążają, 4 tak; sieć nic nie tworzy ani nie gubi (z szybami); graf (bok,
szyb, jeden pokład na skok, pary raz); kratka tylko w górę i nie za poziom;
pokój w próżni nie dostaje udziału; „wisp" pod ROOM_EMPTY dla człowieka
i szczura; szczur nad śluzą ginie; domyślny rozdział fregaty/scouta;
od lewej przy odwróconej liście; ciemna winda nikogo nie bierze, ścieżka
idzie do zasilonej; **przejazd w toku dojeżdża przy SCRAM**; wrak; wróg;
migracja starego zapisu (z broni, raz); niebieskie pipsy przez prawdziwy
`drawHUD`; OFF przez `Ship.draw`.

Przepisane (intencja ta sama, liczby nowe): „kanał ma jeszcze powietrze, gdy
ogień gaśnie" > 0,25 (było 0,5 — szybszy upust); „kanały schodzą do suchego"
≤ ROOM_EMPTY; „pokój i kanał razem" < 0,04 (szyb dolewa do kanałów przy nim);
„sekunda kosztuje dokładnie oddech" liczy wszystkie komórki z szybami;
„powietrze do kanału przed pokojem" — sieć wstrzymana w tym teście (sprawdza
same rury); „9 gąb na 1 pipie" — gęby nieśmiertelne (patrz niżej). Pomocnik `powerModule` dolicza windy do reaktora („płaci za
wszystko").

`break_check.js`: **30 rewertów `#90`** + przestawione kotwice **#84**,
**#86b** (linia szczura → `dry`). Razem **765 wpisów, 0 złych kotwic**.
Pierwszy przebieg 30/30, drugi 30/30 + #84 + #86b, trzeci (po poprawce
testu niżej) 30/30.

**Niestabilny test złapany po drodze:** „kanały schodzą do suchego" (9 gąb na
1 pipie) padał w ~1/3 przebiegów pod obciążeniem z kanałem na **1,0**: z siecią
kanały schodzą wolniej, tłum zdążał się udusić, 1 pip przerastał resztę
i pompy dolewały kanały do pełna. Ludzie w tym teście są teraz nieśmiertelni
(deficyt to założenie testu). Po poprawce 6/6 zielonych przy dwóch
równoległych przebiegach.

**Pułapka narzędziowa (bez zmian):** break_check tylko na kopii z `git archive`
— przy niezacommitowanych zmianach `git archive $(git stash create)`.

**Dalej:** 89a/90a z uwag jj z grania 87–90; potem update91 (wróg na tych
samych zasadach + walka w parach), później 14 i 28.

## 5-0m. ZMIANY update89 (SZKODNIKI: WŁASNE ZEGARY, WRAKI ZE SZCZURAMI, 2 BŁĘDY Z GRY)

Punkty 3, 4, 5 z listy z 30.09 plus dwa błędy zgłoszone w trakcie (powietrze
nie wraca po szczurach, jajo w porcie).

### 1. Każdy szczur na własnym zegarze (pkt 5)

- `rat.metab` (0,8–1,25, losowane przy narodzinach, zapisywane) mnoży
  głodnienie — gniazdo nie działa w jednym takcie
- młode z miotu rodzą się z różnym brzuchem (`PUP_FULL_MIN`–100)
- **dorosły** (poz. 3, bez jedzenia): jeden zegar `_chewT` (CHEW_MIN–MAX);
  gdy minie — jeśli ktoś stoi pod nim i szczur jest zły (głodny),
  z szansą `DROP_SHARE` (40 %) **skacze** na człowieka, inaczej **gryzie
  kabel** (poziom modułu). Stały zegar ugryzień `BITE_MIN/MAX` skasowany
- **średni** (poz. 2, bez jedzenia): własny zegar `_shortT`
  (SHORT_MIN–MAX); **tylko w walce** robi **zwarcie** — moduł pod nim martwy
  na `SHORT_SECONDS` (ścieżka jonowa), ludzie w nim ogłuszeni, napis
  SHORTED i komunikat. Moduł nie traci poziomu

### 2. Skok może chybić (pkt 4)

`PEST_TUNING.BITE_HIT = 0.6` — w klatce ugryzienia szczur **i pająk** trafiają
w 60 %; reszta to napis MISSED. Ta sama reguła na statku i na wraku
(`_pestDrop` jest jeden). Pająk zostaje na swoim zegarze POUNCE; szczur skacze
tylko ze swojego zegara (`_startDrop`, wspólny początek skoku).

### 3. Wraki ze szczurami (pkt 3)

- `derelictNestKind()` — ~35 % wraków (`RAT_WRECK_SHARE`) ma szczury zamiast
  jaj; `populateDerelict(ship, sector, kind)` — szczury poz. 2–3, głodne
  (10–30), jeden na przedział, liczba = pająki+1; `ship.nestKind`
- `_startWreckBoarding(sector, { nest })` — łupy **chudsze**:
  `makeWreckGrid(…, { lean })` = jedna skrzynia mniej, stosy do 40 % zamiast
  70 %, połowa szansy na chip. Komunikat przy dokowaniu: „the ducts are
  squeaking — rats have had this one"

### 4. BŁĄD: tlen stał na 0 po szczurach

Kanał nad **pustym** pokojem wykrwawiał się (`DUCT_BLEED` 0,6/s) zawsze — także
gdy nie było dziury. Nadwyżka pomp idzie najpierw do kanału (tam są rury),
kanał tracił ją szybciej niż dostawał, pokój nigdy nie dostawał reszty —
wskaźnik 0 z włączonym O2. Teraz kanał krwawi **tylko w przedziale, który
cieknie**: `OxygenManager.leakingRooms(ship)` = otwarta śluza lub
niezałatana dziura w nim albo połączony otwartymi drzwiami. Test: statek
z zerem wszędzie, O2 na 2, 3 ludzi → po minucie > 30 %, żaden pokój na zero.

### 5. BŁĄD: jajo w porcie się wykluwało, potem znikało

Dwa osobne błędy:
- **podgląd kadłuba w bazie** (`BaseScreen._previewShip`) przepuszczał
  60 klatek `ship.update` na kopii statku — z kanałami, głodem i zegarem jaj,
  i z prawdziwymi komunikatami, przy każdej przebudowie podglądu. Teraz
  `sh.isPreview = true` → `Ship.update` nie woła `pestTick`, `hungerTick`,
  `infectionTick`; komunikaty podczas tej pętli wyciszone
- **start kontraktu** zastępował ładownię statku tą spakowaną w bazie —
  jajo (którego stocznia nie przyjmuje, więc jedzie w ładowni statku) ginęło.
  `_launchHold(stara, spakowana)`: jaja idą do spakowanej; gdy brak miejsca,
  siatka budowana od nowa z jajem najpierw, a wypchnięte skrzynie wracają
  na półkę magazynu (z komunikatem). Szczury i pająki zostają w kanałach
  jak dotąd (86b)

### 6. Testy

Sekcja **271**: metabolizmy i młode przez `pestTick`; rzut monetą dorosłego
wymuszony w obie strony; trafienie/pudło dla szczura i pająka; zwarcie
w walce / poza walką / z jedzeniem (przez podmieniony `CombatManager.isActive`);
wraki ze szczurami, udział ~1/3, chude łupy, komunikat przez
`_startWreckBoarding`; szczur na wraku skacze na abordażystę; powietrze wraca;
śluza nadal opróżnia pokój i kanał; `leakingRooms` przez drzwi; **cała droga
jaja**: kontrakt → `_finishContract` → `BaseScreen.draw` (cisza, jajo dalej
w zapisie kadłuba) → kolejny `_startContract` (jajo na pokładzie, szczur
w kanale). Przepisane: 267 „głodny dorosły gryzie rzadko" (30 min okna na nowym
zegarze), 60 „pająk w końcu skacze" (dłuższe okno — może chybić), trasa
wraku z mapy (akceptuje oba rodzaje gniazda, ale jeden na wrak).

`break_check.js`: **29 rewertów `#89`** + przestawione kotwice 10 starych
(#69, #85×2, #86×6, #86b), które wskazywały na zmieniony kod.
Pierwszy przebieg przepuścił cztery: zwarcie „z jedzeniem" (szczur na
brzuchu 50 zjadł i urósł do dorosłego — test nie był już o średnim szczurze),
chude łupy (porównanie z szansą na chip maskowało brak odjętej skrzyni — teraz
liczone skrzynie bez chipów, max 3 z 4), flaga podglądu (komunikaty i tak
wyciszone — test łapie teraz statek z podglądu i sprawdza, że jajo i szczur się
nie zestarzały), pełna ładownia przy starcie (nowa droga testowa: spakowana
ładownia pełna płyt). Drugi przebieg 29/29.

Razem **5129 asercji + 83 kroki rysowania + 90 w przeglądarce**, zielone także na czystym checkoucie.

**Pułapka narzędziowa:** `node -e "require('tests/break_check.js')"` w katalogu
roboczym **uruchamia** rewerty na żywych plikach — przerwany timeoutem zostawił
jeden rewert (#3) w `systems.js`. Przywrócone z HEAD. break_check tylko na kopii
z `git archive`.

**Dalej:** update90 (sieć wentylacji, windy bez prądu liczone od lewej),
update91 (wróg na tych samych zasadach + walka w parach), później 14 i 28.


## 5-0n. ZMIANY update88 (CZYTELNOŚĆ EKRANU)

Punkty 1, 7, 11, 15, 16, 21, 25 z listy z 30.09.

### 1. Log w prawym dolnym rogu (pkt 1)

`UI` trzyma **ostatnie 60 komunikatów** niezależnie od wszystkiego. W walce,
przy otwartym oknie, czyta się je w panelu `LOG_RECT` (866,492 · 406×196):
najnowszy na dole, tyle ostatnich, ile się mieści, każdy zawinięty, nowy
podświetlony przez 2 s, kolorowy pasek według typu. **Wyskakujące okienka na
środku (zasłaniały twój kadłub) w walce się wtedy nie rysują.** Zamknięte
okno → wracają. Poza walką (mapa, baza) — jak dawniej.

Przełącznik: zakładka „LOG ▾ [L]" nad panelem (klik idzie przez
`_handlePowerBarClick`, jak inne przyciski HUD) albo klawisz **L**.

### 2. Jedna ikona modułu (pkt 15)

`Renderer.drawSystemIcon(ctx, type, cx, cy, size, col)` — **jedno** wywołanie
rysuje ikonę modułu: **grafikę z `art/`** (białe PNG barwione na kolor, który
miałby znak), a gdy pliku nie ma — znak z `SYSTEM_GLYPHS`. Używane w rogu
modułu, na pasku mocy (twoim i wroga) i przy znaczniku konsoli załoganta.
**Ikona na środku pokoju skasowana.**

**Złapane na zrzucie:** stary znak zostawiał za sobą `textAlign = 'center'`,
a podpisy pod ikonami paska mocy na tym polegały — ścieżka z grafiką tego nie
robiła i podpisy zjechały o pół słowa w prawo. Funkcja ustawia wyśrodkowanie
na obu ścieżkach.

**Pułapka narzędziowa:** mój serwer do zrzutów czytał PNG jako tekst UTF-8 —
grafika się nie ładowała i zrzut pokazywał znaki. To nie był błąd gry.
Narzędzie `live.js` (w scratchpadzie sesji) serwuje `game.js` z tą samą
podmianą eksportu co harness — pozwala postawić PRAWDZIWĄ walkę w przeglądarce.

### 3. Podpowiedź modułu (pkt 11)

Najechanie na moduł twojego statku (nie na załoganta — wtedy panel
umiejętności jak dotąd) pokazuje okno z `Ship.moduleInfo(sys)`: nazwa, poziom,
zasilenie, uszkodzenia, i wiersze „co daje który poziom" — **zielone to, co
moduł już robi, szare to, do czego brakuje poziomów lub prądu**. W walce
i w widoku statku na mapie.

**Każda liczba czytana z reguły, którą opisuje**: `Ship.CURE_LEVELS`,
`MEDBAY_HPS`, `CURE_SECONDS`, `OXYGEN.PER_POWER/BREATHING`, `SYSTEM_DEFS`…
Stałe uników wyciągnięte z `evasion` do `Ship.EVADE_PILOT/EVADE_ENGINE`,
naprawa zatoki do `Ship.AUTOREPAIR_RATE` — jedna liczba dla wzoru i dla okna.
Kilka opisów w `SYSTEM_DEFS` było nieaktualnych (O2 „szybsze napełnianie",
medbay bez drabiny leczenia) — okno ich nie używa.

### 4. Tlen w rogu, zawsze (pkt 16)

`O₂ NN%` w prawym górnym rogu części podłogowej (pod kanałem), **zawsze**, także
przy 100%. Szary gdy pełny, niebieski gdy spada, pomarańczowy przy ostrzeżeniu,
czerwony krytycznie. Zabarwienie pokoju jak dotąd tylko poniżej 95%.

### 5. Zdrowie na pokładzie w kwadracikach (pkt 21)

Pasek nad załogantem to teraz `Renderer.drawPips` — ten sam co na liście,
kratka na 20 HP (Terra ma 4, reszta 5).

### 6. Ładownia (pkt 7, 25)

- **podwójny klik** (≤0,35 s, w to samo miejsce) przenosi przedmiot na drugą
  stronę: najpierw dolewa do pojemnika tego samego rodzaju, potem pierwsze
  wolne miejsce; brak miejsca → wraca na swoje i mówi o tym. Reguła `locked`
  (czego stocznia nie weźmie) obowiązuje tak samo
- **skrzynia z bronią** w dolnym panelu: nazwa broni w tytule, rola, obrażenia
  × strzały, ładowanie, prąd, rakiety. Tekst „rozpakuj do stojaka na broń"
  skasowany — stojaka nie ma od update75; **UNBOX & FIT** montuje broń
  w wolnym gnieździe i tak to teraz opisano

### 7. Testy

Sekcja **270** (33 asercji): log przez `UI.draw` i przez **własną klatkę
gry** (`T._draw` w walce), zakładka przez `_handlePowerBarClick`, L przez
`_updateCombat`; ikony przez to, co ląduje na pasku mocy; tip przez `T._draw`
z kursorem nad medbayem; uniki porównane z **prawdziwym** `ship.evasion`;
podwójny klik przez `LootScreen.update` z prawdziwymi kliknięciami (w obie
strony, za wolno, brak miejsca). Przepisane stare: odznaka modułu (sprawdzała
tekst źródła), paski zdrowia (liczyły prostokąt 24×3 — teraz kratki).

`break_check.js`: **29 rewertów `#88`**. Pierwszy przebieg przepuścił cztery:
dwa to drogi przez `game.js` (panel i tipy włączane przez grę — testy wołały
`UI.draw` z flagą ręcznie), jeden to obraz na środku (silnik testowy nie ma
grafik, więc rewert nic nie rysował — test dostaje podstawiony obrazek i sprawdza
POŁOŻENIE, bo kafelki tła też rysują 26×26), jeden to uniki (test porównywał
stałą ze stałą). Drugi przebieg 29/29.

Razem **5059 asercji + 83 kroki rysowania + 90 w przeglądarce**, zielone
także na czystym checkoucie.

## 5-0o. ZMIANY update87 (BALANS I SZYBKIE POPRAWKI)

Pierwsza paczka z listy 29 punktów gracza z 30.09 (podział na 87–91 w projekcie:
`ustalenia-2026-09-30-lista-29-punktow.md`). Punkty 2, 6, 8, 12, 13, 17, 22, 23,
24, 26.

### 1. O2 poziom 2 minimum (pkt 2)

- **gracz**: wszystkie trzy kadłuby budowane z O2 na 2; kadłub ze starego zapisu
  z O2 na 1 wychodzi z hangaru na 2. **Bez dodatkowego prądu** (decyzja gracza) —
  na Bastecie domyślnie silniki dostają 1 zamiast 2, rozdział jest jego
- **wróg**: `Ship.sizeAirForCrew(n, {boss})` — poziom `ceil(n/3)`, min 2, boss
  min 3, max 4, a **reaktor pokrywa całe zapotrzebowanie** (także ponad limit
  kadłuba). Wołane NA KOŃCU budowy wroga, po `_seatCaptives`
- **przy okazji naprawiony stary błąd**: moduł karbonitu dla jeńców był dokładany
  po wyliczeniu reaktora, więc wróg z jeńcami latał o 1 pips za krótko

### 2. Apteczki w portach (pkt 6)

`stock.medkits` 1–(4+sektor/2) zestawów po 10 dawek, `medkitCost` = wartość
dawek × karma, `buyMedkits` jak racje (próba na kopii ładowni, płaci się za to,
co weszło). Karta MEDICAL SUPPLIES w zakładce REPAIR.

### 3. Broń (pkt 8, 24)

Lasery lecą 320 px/s (było 240), ciężki 310. **Burst: 2 strzały, 10 s** (było
3 / 14). Dwa stare testy „burst płaci ≥2 s więcej niż ciężki" przepisane na
liczby gracza.

### 4. Ogień wolniej (pkt 12)

`FIRE_DEFS`: rozprzestrzenianie 20 s (12), szansa 0,45 (0,6), wzrost 15 s (9),
moduł 0,3/s (0,5), człowiek 1,8 HP/s (3), kadłub co 10 s (6). Stare wartości
w komentarzach obok.

### 5. Jedzenie (pkt 13, 17)

- **automat dopiero przy zerze** — gdy głód zaczyna zabierać HP. Wcześniej
  poniżej 40, więc ikona „głodny" i „je" pojawiały się naraz. Wcześniejsze
  karmienie to rozkaz FEED — decyzja gracza
- **posiłek 6 s** (3)
- **znalezione przy okazji**: opatrunek i apteczka pożyczały długość posiłku,
  więc podwoiłyby się razem z nim. Rozdzielone: `Ship.AID_SECONDS = 3`
- ikona głodu znika na czas jedzenia

### 6. Terra (pkt 22) — BUG, nie balans

Terra ma 80 HP w `CORP_DEFS` od update55 — **ale tylko ktoś zbudowany z jawnym
`race: 'terra'`**. Konstruktor liczył HP z `cfg.race`, a załoga startowa i rekruci
losują korporację i mają `cfg.race` puste → **każda losowa Terra miała 100**.
Teraz czyta `this.race`. Terra ze starego zapisu (baza 100) wraca na 80,
premia dowódcy zachowana jako ten sam ułamek.

Nowe: **Terra przy konsoli reaktora daje reaktorowi +1** (`Reactor.cyborgBonus`),
tylko gdy reaktor ma choć jeden sprawny poziom.

### 7. Celowanie nienaładowaną bronią (pkt 23)

Broń, która się ładuje, da się wybrać (klik / cyfra) i wskazać pokój — dostaje
`queuedShot` i strzela tam **raz**, w chwili naładowania. Odmowy inne niż
„ładuje się" (brak amunicji, brak walki) dalej są mówione (`CombatManager.aimRefusal`
— sprawdza walkę i amunicję). Uzbrojona broń zachowuje się jak dotąd.

**Złapane przez test, zanim wyszło:** pierwsza wersja brała odpowiedź
`fireRefusal` i przepuszczała „ładuje się" — ale `fireRefusal` zatrzymuje się na
ładowaniu i **nigdy nie dochodzi do amunicji**, więc pustą armatę dało się
wycelować. Amunicja wydzielona do `_ammoRefusal`, pytana osobno przez oba.

### 8. Windy wolniej (pkt 26)

`ElevatorShaft.CABIN_SPEED = 55` px/s (było 80, wpisane w środku funkcji).

### 9. Testy

Sekcja **269** (30 asercji), drogą gry: `_spawnEnemy` ×40, `BossManager.start`,
`Station.buyMedkits`, `Weapon.fire`, `FireManager.update`, `Ship.update`,
`_updateCombat` z klawiszem i kliknięciem. Przepisane stare: burst (2), test
barakowy zakładający 100 HP (przypięta korporacja), test „zapisana Terra na 100
wraca na 100" (odwrócony — gracz chce 80), testy automatycznego jedzenia (głód
0 zamiast „trochę poniżej progu").

`break_check.js`: **28 rewertów `#87`**, 5 starych przecelowanych. Pierwszy
przebieg przepuścił dwa: jeden to był zły rewert (zamieniał kolejność nie tych
wywołań — poprawiony, a test dostał warunek, że w próbce 40 wrogów są statki
z jeńcami), drugi pokazał **prawdziwy błąd** z §7 (pusta armata dawała się
wycelować). Drugi przebieg 28/28 + 5/5.

Razem **5023 asercje + 83 kroki rysowania + 90 w przeglądarce**, zielone także
na czystym checkoucie.

## 5-0p. ZMIANY update86b (POPRAWKI PO GRANIU: POWIETRZE I SZCZURY)

Pierwsze granie w 84–86a, zgłoszenia gracza z 29.09 wieczorem:
*„teraz jest za łatwo — brak powietrza, niewystarczająca ilość i szczury
padają; musi być tak, że szczury padną, ale załoga też, chyba że będziemy ich
leczyć"*, *„słabo wygląda, jak w wentylacji nie ma powietrza, a w modułach
jest"*, *„dorosły też powinien się rozmnażać"*, *„po powrocie do bazy szczury
nie znikają, zostają na danym statku"*.

### 1. Kolejność powietrza — POPRAWIONA reguła gracza

| co | najpierw | potem |
|---|---|---|
| **dziura** (śluza, wyrwa) | moduł | kanał (bez zmian od 85) |
| **za mała produkcja** (O2 działa, nie nadąża) | **moduł** | kanał — rury biegną kanałem, więc kanał kończy się ostatni |
| **O2 wyłączony / bez prądu** (nic nie płynie) | **moduł i kanał RÓWNO** | — |
| nadwyżka | kanał | moduł (bez zmian) |

update85 miał niedobór „najpierw kanał", czyli czerwony kanał nad pokojem pełnym
powietrza i szczury padające od małego niedoboru, zanim załoga coś poczuła.
**Wiersz „za mała produkcja" jest odwrócony, „O2 wyłączony" jest nowy.**
`RoomOxygen._pipe(amount, flowing)`; `flowing` = produkcja > 0.

### 2. Szczur wstrzymuje oddech

`RAT_TUNING.AIR_SECONDS = 12` — zapas jak zwykły skafander (decyzja gracza;
człowiek ma 8, Pegasus 26). Potem traci HP jak człowiek (`SUIT_AIR.DAMAGE_PER_SEC`),
po powrocie powietrza odzyskuje oddech w tempie skafandra.

**Rachunek, o który chodziło:** wyłączasz O2, powietrze spada równo w pokoju
i kanale; gdy go zabraknie, dorosły szczur pada po ~18 s (12 + 28 HP / 5),
zwykły załogant w tym czasie traci ~50 HP (8 s zapasu, potem 5 HP/s). Szczury
padają, **załoga też obrywa, chyba że ją potem połatać** — apteczką albo
w medbayu. Pegasus wychodzi bez szwanku.

### 3. Dorosły też się rozmnaża

Każdy posiłek od poziomu 2 w górę to miot 2–5. Hamulcem jest `MAX_ABOARD 12`
(test: godzina z pełną ładownią dochodzi do 12 i ani jednego więcej).

### 4. Szczury zostają na statku

Dezynsekcja w stoczni z update84 **skasowana**. Szkodniki jadą w zapisie kadłuba,
hangar go trzyma, przy następnym starcie wychodzą razem z nim — z tym samym
poziomem i głodem. Pozbyć się ich można kotem albo powietrzem, nie dokiem.

### 5. Testy

Sekcja 266 przepisana w części o niedoborze (trzy przypadki zamiast jednego,
plus oddech szczura), 265 „stocznia robi dezynsekcję" → „szczury wracają na
następny kontrakt" (start → dok → start, drogą gry), 267 + miot dorosłego
i limit po godzinie.

**Dwa rewerty skasowane, bo gracz odwrócił to, co chroniły:** #84 „stocznia
nie robi dezynsekcji" i #85 „niedobór najpierw z modułu". Na ich miejscu
#86b w przeciwną stronę.

`break_check.js`: **8 rewertów `#86b`**, 5 starych przecelowanych. Pierwszy
przebieg przepuścił dwa:
- **„równy podział ignoruje objętość kanału"** — prawdziwy błąd rachunkowy
  (statek traciłby o 1/3 więcej powietrza, niż się oddycha). Dopisany test
  zachowania: sekunda kosztuje kadłub dokładnie tyle, ile się oddycha
- **#85 „szkodnik oddycha powietrzem pokoju"** (przecelowany) — **skasowany**:
  po poprawce kanał nigdy nie jest pusty, gdy pokój ma powietrze, więc oba
  odczyty dają to samo. Kod dalej czyta kanał; rewertu nie da się złamać

Drugi przebieg 8/8 + 4/4. Razem **4988 asercji + 83 kroki rysowania + 90
w przeglądarce**, zielone także na czystym checkoucie.

## 5-0q. ZMIANY update86a (SZYB WINDY, KIERUNEK, WIDOCZNOŚĆ)

Trzy zgłoszenia gracza z 29.09, wydzielone z 86, żeby ekonomię szczurów dało
się wyważać osobno.

### 1. Szczury i pająki zmieniają pokład szybem windy

*„mamy winde wiec beda uzywac tego jako szyb windy"*. update84 zmierzył, że
`Room.adjacent` nie łączy pokładów na żadnym kadłubie — **ta paczka dokłada to
połączenie i jest nim szyb**.

`Ship.ductLinks(roomId)` — jedna lista „dokąd z tego kanału":
- **w bok**: `Room.adjacent`, jak dotąd
- **góra/dół**: pokój, którego ściana końcowa stoi na szybie (`SHAFT_REACH 20`
  od osi), łączy się z pokojem **o jeden pokład wyżej i niżej, po TEJ SAMEJ
  stronie szybu** i w zasięgu szybu (`extentTop/Bottom`)

Liczone raz na kadłub i trzymane (pokoje i szyby się nie ruszają).

**Wspinaczka** (`p._climb`): szkodnik idzie do ściany na szybie, wspina się
szybem (rysowany w jego osi, **głową w kierunku ruchu**, obrócony o ćwierć
obrotu) z własną prędkością, wychodzi w kanale drugiego pokładu przy tej
samej ścianie. W szybie **kot go nie dosięgnie, a pająk z niego nie skacze**.
Pająk idzie do ludzi także szybem. Stan wspinaczki nie jest zapisywany —
po wczytaniu szkodnik siedzi w kanale, z którego wyszedł.

**Złapane na zrzucie, nie w teście:** wspinający się szczur był malowany
**pod** szybem — `elevators.draw` idzie po szkodnikach i zamalowywał go. Pierwszy
zrzut pokazał pusty szyb. Wspinający się są teraz rysowani po windzie; test
pilnuje kolejności wywołań przez całe `ship.draw`.

### 2. Szczur szedł zawsze ogonem naprzód

*„animacja narazie jest tylko w jednym kierunku"*. Dokładnie błąd kota
z update47: `Pest.draw` odbija klatkę, gdy szczur idzie w lewo, więc grafika
musi patrzeć w PRAWO — a była narysowana głową w lewo. Szczur szedł tyłem
w obie strony. Poprawione w generatorze (`_genRat`: `ctx.scale(-1, 1)`), tak
jak u kota; `Pest.draw` zostaje jedynym miejscem, które wie o kierunku.
Pająk jest rysowany od przodu i tego nie miał.

Test w **prawdziwej przeglądarce** (sesja 6): na pikselach klatki głowa jest
cięższym końcem, więc tusz po jej stronie przeważa — i ma być po prawej.

### 3. Widać tylko tam, gdzie ktoś jest

*„szczury pajaki jaja widac tylko w tym pomieszczeniu jak jest zalogant lub kot"*.
`Ship.pestVisible(roomId)`: w pokoju stoi **twój** człowiek (nie w płycie)
albo kot. Abordażysta wroga nie liczy się. Ukryte: szczury, pająki, kokony,
jaja w kanale (`_drawEggs`). Wspinający się jest widoczny z każdego końca
wspinaczki.

**Komunikaty zostają** (decyzja gracza): nie widzisz szczura, ale
„coś przegryzło kabel" dalej przychodzi. Ukryte jest ciało, nie skutek.
**Stan kanału** (powietrze, ogień) też zostaje widoczny — to nie szkodnik.

Uwaga: to odwraca zasadę U9 „kanał MUSI być widoczny, żeby gracz wiedział,
że ma szkodniki" — świadomie, na życzenie gracza.

### 4. Testy

Sekcja **268** (26 asercji), 1 nowy krok `smoke_draw` (szkodnik nad pustym
pokojem się nie rysuje), 1 nowa asercja w `browser_test` (kierunek grafiki).
Stary test „nigdy nie zmienia pokładu" (265) przepisany na „każda zmiana
pokoju idzie po `ductLinks`"; jego „był w każdym kanale" okazało się
**losowe** (błądzenie losowe: 8 z 9 raz na kilka przebiegów) — teraz
„co najmniej 5 kanałów i 2 pokłady".

`break_check.js`: **18 rewertów `#86a`** (jeden z nich `browser: true` — kierunek
grafiki sprawdza tylko prawdziwa przeglądarka), 1 stary przecelowany (#84
„przez ściany" — sieć to teraz `ductLinks`). Dwa przebiegi, oba czyste.
Razem **4976 asercji + 83 kroki rysowania + 90 w przeglądarce**, zielone także
na czystym checkoucie.

## 5-0r. ZMIANY update86 (EKONOMIA SZCZURÓW)

U10B, plus dopisek gracza z 29.09: **szczury rzadko atakują załogantów** —
decyzja: **tylko dorosły i głodny**. Szyb windy, animacja w obie strony
i widoczność tylko przy załodze/kocie poszły do **86a** (osobna paczka, żeby
dało się wyważyć jedno bez drugiego).

### 1. Trzy poziomy, a posiłek je przesuwa

| lvl | HP | co robi | posiłek → |
|---|---|---|---|
| **1 młody** | 10 | je z ładowni | lvl 2 |
| **2 rozpłodowy** | 18 | je; **jego posiłek to miot 2–5 młodych** w tym samym kanale | lvl 3 |
| **3 dorosły** | 28 | je; **bez jedzenia w ładowni gryzie kabel** modułu pod sobą; głodny do tego rzadko skacze na człowieka | — |

Rysowany w rozmiarze 0,7 / 0,85 / 1,0. Pasażerowie na gapę przychodzą jako 1–2;
szczur ze starego zapisu (18 HP) wczytuje się jako rozpłodowy. Rosnąc,
**zachowuje rany** (nowe ciało, te same dziury).

### 2. Reguła, która robi z tego decyzję

> **Szczury nie gryzą kabli, dopóki mają co jeść.**

„Mają co jeść" = to, co wybrałby dla nich **jedyny wybierak posiłku**
(`mealFor`): **najpierw jajo pająka** (jak kot), potem najgorsza racja. Do tego
**kokon w ich własnym kanale** — zjedzony na miejscu, przed czymkolwiek
z ładowni. Gracz z plagą szczurów ma więc mniejszy problem z pająkami, ale
jaja za 60 CC znikają.

Szczur je **jedną porcję ze stosu**, tak jak człowiek. Stary kod, który przy
skoku rzucał monetą i psuł **całe pudło**, skasowany — dwie drogi szczura do
jedzenia byłyby dwiema odpowiedziami na pytanie, ile kosztuje.

**Gryzienie zbija moduł o JEDEN poziom** (`damageLevel(1)`), raz na 25–45 s.
Stare 3-sekundowe zwarcie „tylko w walce" skasowane: przełącznikiem jest
ładownia, nie bitwa.

**Ugryzienie** to ten sam skok z kanału co u pająka (`_pestDrop`, jedna
funkcja na oba), raz na 45–90 s, 3 HP, **bez wirusa**.

### 3. Głód i śmierć głodowa

Sytość 100 → 0 w 20 minut; szczur szuka jedzenia poniżej 50, głodny (i groźny)
jest poniżej 30. Na zerze **„wytrzymuje długo"**: 1 HP co 30 s — młody pada po
ok. 5 min, dorosły po ok. 14. Limit na kadłub: **12 szczurów** (miot się nie
rodzi ponad niego).

### 4. Pokrętła — WSZYSTKIE w `RAT_TUNING` (`pests.js`)

`LEVELS` (HP/rozmiar), `HUNGER_PER_SEC 1/12`, `EAT_BELOW 50`, `MEAL 60`,
`HUNGRY 30`, `STARVE_EVERY 30`, `LITTER 2–5`, `MAX_ABOARD 12`,
`CHEW 25–45 s`, `BITE 45–90 s / 3 HP`. To jest ta paczka, w której mają być
wyważane — **żadna z tych liczb nie siedzi nigdzie indziej**.

### 5. Testy

Sekcja **267** (36 asercji), przez `pestTick` i całe `ship.draw`. Dwie stare
asercje przepisane (zwarcie w walce, psucie racji przy skoku) — opisywały
zachowanie, które ta paczka celowo zastępuje.

`break_check.js`: **26 rewertów `#86`**, 2 stare przecelowane (#81 jajo dla
kota, #84 martwy szkodnik — linie, do których doszły szczury). Pierwszy
przebieg przepuścił dwa:
- **„szczur gryzie mimo jedzenia"** — warunek bez znaczenia: szczur z jedzeniem
  w zasięgu najpierw je (+60) i nie bywa głodny. **Skasowany**, nie testowany
- **„zagłodzony szczur zostaje w liście"** — `return` pilnuje, żeby szczur,
  który właśnie padł, nie ugryzł jeszcze w tej samej klatce. Prawdziwa reguła,
  brakowało testu — dopisany

Drugi przebieg 26/26 + 2/2. Razem **4951 asercji + 82 kroki rysowania + 89
w przeglądarce**, zielone także na czystym checkoucie.

**Zauważone na zrzucie:** szczur chodził ogonem naprzód — poprawione w 86a.

## 5-0s. ZMIANY update85 (OGIEŃ I POWIETRZE W KANALE)

> **⚠️ Kolejność przy niedoborze z tej sekcji jest NIEAKTUALNA — poprawiona
> w update86b (§5-0).** Za mała produkcja: najpierw moduł; O2 wyłączony: równo.

U11. Kanał pod sufitem każdego modułu ma **własne powietrze** i jest **drogą
ognia**. Zero nowego UI: robią to dwa przełączniki, które gracz już ma.

### 1. Kolejność opróżniania — reguła gracza (29.09)

| co zabiera powietrze | najpierw | potem |
|---|---|---|
| **dziura** — otwarta śluza, wyrwa w kadłubie, drzwi do takiego pokoju | **moduł** | kanał (wykrwawia się, gdy moduł pod nim jest pusty) |
| **niedobór** — wyłączony O2 albo za dużo ust na moduł | **kanał** (rury tlenowe biegną kanałem) | moduł |

Nadwyżka tlenu idzie tą samą drogą co niedobór: **najpierw napełnia kanał**.

Skutek, którego nikt nie projektował, a który jest sednem: **wyłączenie O2
dusi szczury, zanim załoga cokolwiek poczuje** (na fregacie: szczur martwy,
moduł pod nim dalej powyżej progu ostrzeżenia), a **otwarcie śluzy gasi pożar
modułu, zanim szczury w suficie to poczują**. Dwa przełączniki, dwa różne
skutki w dwóch różnych chwilach.

**Liczby** (`OXYGEN`, jedno miejsce): `DUCT_THIN 3` — kanał to cienka rura,
ta sama ilość powietrza rusza jego poziom 3× bardziej niż poziom modułu;
`DUCT_BLEED 0.6/s` — tempo wykrwawiania kanału nad pustym modułem;
`ROOM_EMPTY 0.005`.

**Szyb windy nie ma kanału** (`addRoom(…, { duct: false })`). Pierwsza wersja
dała mu kanał, którego nic nie ruszało — i statek z wyłączonym O2 **nigdy się
nie dusił do końca**, bo średnia wisiała na dwóch wiecznie pełnych kanałach
szybów. Złapał to istniejący test „martwy moduł kończy się uduszeniem".

**Wskaźnik tlenu liczy kanały** (`averageO2`, każdy kanał w swojej cienkiej
objętości). Inaczej przy wyłączonym O2 pasek stałby na 100%, podczas gdy
wszystkie kanały na statku wysychają.

### 2. Ogień: kanał jest pośrednikiem

Decyzja gracza: **„tylko pośrednik"** — kanał nie ma własnego ognia.

- pali się **dokładnie wtedy, gdy moduł pod nim**, od `DUCT_CATCH = 4 s`
  pożaru, i **tylko, jeśli ma powietrze** (`DUCT_MIN_AIR 0.08`)
- **stara mechanika rozprzestrzeniania bez zmian**, z jednym warunkiem
  w środku: rzut na sąsiada odbywa się tylko przy płonącym kanale. Pożar pod
  suchym kanałem zostaje tam, gdzie jest
- **szkodnika pali płonący kanał**, nie pożar modułu — czyli po 4 s, nie od razu
- rysowane: płomienie wzdłuż kratki kanału; poziom powietrza kanału jako
  niebieski/czerwony odcień na kratce

### 3. Czego tu NIE ma

- **przełącznika kanału** — gracz odrzucił (29.09)
- **gaszenia kanału przez załogę** — nie ma czego gasić, kanał gaśnie z modułem
- zapisu poziomów powietrza — nie było go dla modułów, nie ma i dla kanałów

### 4. Testy

Sekcja **266** (26 asercji), przez `ship.update` z prawdziwą śluzą
otwieraną jak kliknięciem (`mode = 'open'`), i przez **całe `ship.draw`** na
atrapie kontekstu — nie przez wołanie malarza kanału wprost. Cztery stare
testy przepięte: mierzyły powietrze modułu tam, gdzie niedobór schodzi teraz
najpierw z kanału (`averageO2` liczy kanały, więc większość przeszła bez
zmian), a stół rozprzestrzeniania ognia musiał dostać wiek pożaru.

**Pułapka z rigu:** śluzę trzyma `door.mode`, nie `door.open` —
`Door.update` przelicza `open` z `mode` co klatkę. Test ustawiający
`open = true` nie otwierał niczego, a test „śluza gasi pożar" przechodził
**mimo to**, bo gasiła go stojąca obok załoga. Teraz załoga jest usunięta
i test sprawdza, że w chwili zgaśnięcia moduł był pusty.

`break_check.js`: **16 rewertów `#85`**; 4 stare przecelowane (#82 bilans
powietrza, #84 ogień/próżnia/pająk — linie przepisane pod kanał).
Dwa przebiegi, oba 16/16 + 4/4. Razem **4919 asercji + 82 kroki rysowania +
89 w przeglądarce**, zielone także na czystym checkoucie.

**Pułapka operacyjna, kupiona teraz:** próbkowanie rewertu ręcznie
i sprzątanie przez `git checkout js/` **cofa też niezacommitowaną pracę**.
Zdarzyło się; odtworzone z tych samych edycji. Od teraz lokalny commit przed
każdym ręcznym rewertem, a break_check na kopii z `git archive`.

## 5-0t. ZMIANY update84 (SZKODNIKI DO WENTYLACJI)

> **⚠️ „Stocznia robi dezynsekcję" z tej sekcji jest NIEAKTUALNE — w update86b
> szczury zostają na statku do następnej wyprawy (§5-0).**

U10A. Szczur i pająk **przestali być załogą**. Do tej paczki to był
`CrewMember` z `isVermin` / `isSpider`, stojący w pokoju i bijący się
z ludźmi, więc każdy system pytający „kto jest w tym pokoju" musiał się
osobno uczyć, że część „ludzi" to nie ludzie. Teraz mieszkają w **kanale
pod sufitem modułu**, na własnej liście `ship.pests`, w nowym pliku
`js/pests.js`.

### 1. Decyzje gracza (29.09)

| pytanie | decyzja |
|---|---|
| kto wyjmuje jajo z kanału | **nikt** — jajo jest w ładowni od razu (sprzedaż 60 CC bez zmian), tylko **rysuje się w kanale** nad miejscem, gdzie padł żywiciel. Ten sam przedmiot: sprzedany albo zjedzony przez kota znika z obu miejsc |
| pająk wyskakuje na załoganta | **gryzie i wraca** — skok, ugryzienie (obrażenia + szansa na wirusa), z powrotem w kanale. Załoga go nie zabije |
| bez kota w 84 | **próżnia dusi szczura już teraz** (czyta tlen pokoju pod kanałem). 85 dołoży tylko to, że kanał pustoszeje pierwszy |
| kokony na wrakach | **też w kanale** — jedna zasada, jedna ścieżka kodu |
| kiedy ładownia wraku jest twoja | **gdy ktoś stał w każdym module** (`searchedAll`). Nieprzeszukane moduły mają na kadłubie zasłonę z napisem `UNSEARCHED`. Zabijanie pająków przestało być warunkiem, bo w kanale nikt z abordażu ich nie dosięgnie |

### 2. Co zabija szkodnika — i to jest cała lista

- **kot** — wchodzi do kanału (rysowany w nim, `cat._ductY`), trzyma
  szkodnika, bije go; pająk **odgryza się** co 3 s i kot **może zginąć**.
  Trzymany szkodnik nie chodzi i nie skacze na nikogo
- **ogień w module pod kanałem** — tempo takie jak na człowieka. Jedyna
  rzecz poza kotem, która zabija pająka
- **próżnia** — tylko szczura (`Pest.breathes` → `SUIT_AIR.NO_LUNGS`)

Załoga **nie może**. To jest sedno zmiany: szkodnikiem zarządza się statkiem,
nie pięściami.

### 3. Co robi szkodnik

- **szczur**: gryzie kable modułu pod sobą **tylko w walce** (ta sama
  `ionHit`, co wcześniej), oddycha z bilansu tlenu statku, nigdy nikogo
  nie atakuje
- **pająk**: siedzi nad pokojem, co 6–14 s skacze na człowieka pod sobą
  i wraca; nad pustym pokojem idzie **do sąsiada, w którym są ludzie**,
  a **nad człowiekiem zostaje**. Tego nie było: zegar ruchu (8–18 s) ścigał
  się z zegarem skoku (6–14 s) i mniej więcej co drugi raz pająk odchodził
  do losowego sąsiada, zanim skoczył. Wyszło, bo stary test „wchodzisz do
  pokoju z kokonem i po chwili cię gryzie" przechodził tylko czasem
- **ruch**: po `Room.adjacent` (decyzja U9, bez pathfindingu), wzdłuż
  kanału, wychodzi przy bliższej ścianie następnego

**Zmierzone, nie założone: kanały nie łączą pokładów.** Na wszystkich
siedmiu kadłubach `adjacent` łączy tylko pokoje obok siebie na tym samym
pokładzie — zero połączeń pionowych. Szkodnik żyje na pokładzie, na którym
się pojawił. Była gałąź „inny pokład" dla połączenia, którego nie ma —
skasowana. Jeśli gracz chce, żeby szczury wędrowały między pokładami, to
jest decyzja o szybach wentylacyjnych, nie poprawka.

### 4. Co zostało skasowane

`isBeast`, `isVermin`, `isSpider` na `CrewMember`: **56 wystąpień w 6 plikach
→ 0.** `makeRats`, `makeSpiders`, `hatchNests`, `verminTick`, `RAT_HP`,
korporacje `rat` i `spider` w `CORP_DEFS`, wiersze `rat`/`spider` w
`SUIT_AIR.TANK`, `CrewMember.breathes`, `eats`, `EGG_SENSE_ROOMS`, sekcja
testów 55 (praca, z której trzymało się pająki z dala — nie ma czego
trzymać). Kot jest **jedynym zwierzęciem w liście załogi** i każdy filtr
pyta już tylko o `isPet`.

### 5. Przeprowadzka zapisów

- szkodniki jadą w **zapisie statku** (`pests: [...]`), martwe nie są zapisywane,
  nierozwinięty kokon wraca nierozwinięty i niewidoczny
- **stary zapis** (sprzed 84) ma szczury w liście załogi. `_continueRun` przez
  `Pest.fromCrewRecord` robi z nich szkodniki w kanale pokoju, w którym stały.
  Nie gubi ich (wczytanie nie może być darmową dezynsekcją) i przycina pająka
  z 45 HP człowieka do pająka z kanału
- **stocznia robi dezynsekcję** przy dokowaniu. Wcześniej działo się to
  przypadkiem (baraki zawsze odrzucały szczury), teraz szkodniki są w zapisie
  kadłuba, który baza trzyma — więc jest to powiedziane wprost

### 6. Po drodze znaleziony bug: kot nie dochodził na inny pokład

`_petSendTo` wołany co klatkę (polowanie, czuwanie przy rannym) planował
trasę od nowa — co na windzie zawraca kabinę i zaczyna jazdę od początku.
Kot wysłany do szczura na innym pokładzie **stał przy szybie w nieskończoność**.
Nikt tego nie widział, bo jedyny test polowania sprawdzał, czy jest trasa,
a nie czy kot doszedł. Teraz: jeśli ostatni punkt trasy to już ten pokój,
nic nie planuje od nowa (czytane z TRASY, nie z notatki — gracz mógł go
w międzyczasie przestawić).

### 7. Czego tu NIE ma

- **ogień i powietrze W kanale** (kanał pustoszeje pierwszy, ogień idzie
  kanałem) — update85
- **poziomy szczurów, rozmnażanie, jedzenie z ładowni** — update86
- połączenia kanałów między pokładami — nie ma ich w danych (§3)

### 8. Testy

Sekcja **265** (42 asercje), plus kilkanaście starych sekcji przepisanych
z „szczur w pokoju" na „szczur w kanale" — przez `ship.update` /
`pestTick` / `_continueRun` / `_dockAtBase`, czyli drogą gry. Nowe kroki
w `smoke_draw.js`: szczur i pająk rysują się w kanale, nie na pokładzie;
niewidoczny kokon się nie rysuje, odkryty tak.

Razem **4893 asercji + 82 kroki rysowania + 89 w przeglądarce**, zielone
także na czystym checkoucie.

`break_check.js`: **23 rewerty `#84`**; 8 starych przecelowanych (linie
przepisane w tej paczce) i 3 skasowane, bo rzecz, którą chroniły, przestała
istnieć (#70 głód szkodnika, #71 szkodnik jako wróg, #82 = #79 po
przeprowadzce). **Pełny przebieg 584/584, zero przecieków, zero zardzewiałych
kotwic.** Pierwszy przebieg `#84` przepuścił jeden („pająk skacze na kota") —
reguła była prawdziwa, brakowało testu.

**Pułapka operacyjna:** trzy shardy na tym drzewie to już ~2 h, nie 70 min —
`timeout 7000` uciął je na 538/584. Resztę dokończyło się w świeżych
kopiach z listą nazw wyciętą z logów. Następnym razem `timeout 9000`.

## 5-0u. ZMIANY update83 (KOT NA ROZKAZ)

Mała paczka z dwóch części, i dopiero druga sprawia, że pierwsza ma sens.

### 1. Rozkaz się trzyma

**`cat._ordered` było czytane w `petTick` od update45 i NIKT NIGDY GO NIE
ZAPISAŁ.** Gałąź była martwa. To, co widział gracz: *„kot chodzi tam gdzie mu
sie pokazuje, nastepnie po chwili chodzi gdzie chce"* — bo kot brał rozkaz
i porzucał go natychmiast, jeśli na statku był szczur, a poza tym w chwili, gdy
wygasał licznik wędrówki, czyli po 3–9 sekundach.

Teraz rozkaz **trzyma**. Kot idzie tam, gdzie pokażesz, i tam zostaje — licznik
wędrówki dalej tyka, ale rozkaz jest sprawdzany przed nim i wychodzi z funkcji.

**Trzy rzeczy go zrywają**, i pierwsze dwie to reguła gracza *„dopóki nie pojawi
się szczur albo ranny"*:

| co | dlaczego |
|---|---|
| **szczur na pokładzie** | polowanie jest tym, DO CZEGO kot jest |
| **człowiek na podłodze** | czuwanie spowalnia wykrwawianie (update45) — to mechanika, nie sentyment |
| **jej własny głód** | kot zagłodzony na posterunku to rozkaz, który zabija, a nie taki, jaki gracz sądzi, że wydaje |

**Flaga jest kasowana**, gdy któraś z nich zadziała — kot wraca do swojego życia
na dobre, zamiast odskakiwać z powrotem na posterunek. Chcesz go tam znowu?
Jedno kliknięcie. Jedno kliknięcie jest tańsze niż kot, którego nie da się
odwołać.

**I dotyczy to też trasy.** Była nad tym linijka — `if (cat._waypoints.length)
return` — czyniąca rozkaz absolutnym do chwili dojścia. **Przebieg łamiący nie
umiał jej złamać**, i tak się wydała: przy niczym, co przebija rozkaz, następny
warunek i tak wychodzi z funkcji, więc ta linijka zmieniała **wyłącznie** to, co
się dzieje, gdy szczur pojawia się w trakcie marszu. Maszerowanie do pustego
pokoju, żeby się tam odwrócić, nie jest lepszym zachowaniem — jest tylko
większą ilością kodu. Skasowana; szczur zawraca kota tam, gdzie akurat jest.

### 2. Kot nie jest załogantem

Dwie rzeczy zmierzone, nie wydedukowane, przy okazji sprawdzania punktu 1.

**Kot naprawiał moduły.** Ten sam klik, który wysyła wszystkich, wysyłał kota
dokładnie tak, jak mechanika: stanowisko, przydział i — jeśli pokój był
rozbity — `TASK.REPAIR`. **I on to robił:** kot sam w uszkodzonej maszynowni
przesuwał licznik naprawy z 0 na 0,43 w trzy sekundy. Zwierzę wykonywało
rzemiosło.

Dalej idzie tam, gdzie pokażesz. **Nie dostaje posterunku ani roboty po
dojściu**, bo ani jedno, ani drugie nie jest rzeczą, którą kot ma.

**Kot zajmował jedno z trzech miejsc w module.** `roomSpaceFor` liczył każde
żywe ciało po swojej stronie, więc kot siedzący w maszynowni **kosztował cię
mechanika** — podczas gdy `takenStationSlots`, druga połowa tego samego pytania
(„kto trzyma tu miejsce"), wyklucza zwierzęta od update43. Dwie połowy jednej
reguły nie zgadzały się ze sobą: kot **blokował rozkaz, nie trzymając nigdy
stanowiska**, o które chodziło.

To jest dokładnie ten typ błędu, który ta gra płaci najczęściej, i dlatego
punkt 2 musiał wejść razem z punktem 1: bez niego „posadź kota w maszynowni"
kosztuje gracza człowieka, czyli rozkaz, który właśnie naprawiliśmy, byłby
rozkazem, którego nie opłaca się wydać.

### 3. Czego tu NIE ma

- **szkodniki do wentylacji** — update84. Dopiero wtedy kot zacznie polować
  w kanale zamiast w pokojach, a „szczur zrywa rozkaz" nabierze pełnego sensu
- **ogień i powietrze w kanale** — update85

### 4. Testy

Sekcja **264**. **8 rewertów `#83`, wszystkie złapane** — plus jeden, który
**przestał istnieć razem z linijką, której nie umiał złamać** (patrz §1).

**Pułapka z rigu, warta zapamiętania.** Pierwsza wersja stołu testowego
odsuwała CAŁĄ załogę na `-9999`, żeby klik w pokój trafił w pokój, a nie
w sprite pod kursorem — **razem z kotem**. Przy sześćdziesięciu pikselach na
sekundę kot spod `-9999` idzie do dowolnego pokoju **sto siedemdziesiąt
sekund**, więc każda asercja „doszedł" padała na zegarze, a nie na regule.
Odsuwani są teraz wszyscy **oprócz zwierząt**, a kot dostaje prawdziwą pozycję
w pokoju startowym.

## 5-0v. ZMIANY update82 (POZIOMY I POWIETRZE)

Dwie duże rzeczy z ustaleń 24.09 i jedna, której nie było w planie, bo wyszła
ze zrzutu ekranu.

### 1. TLEN — był zepsuty gorzej, niż mówiły ustalenia

**OBIE połowy liczyły się NA POKÓJ:**

```js
refill = REFILL_PER_POWER * o2Power     // …w KAŻDYM pokoju
drain  = BREATHING                      // …w KAŻDYM pokoju
```

Każda komora dostawała **PEŁNĄ** produkcję modułu, więc ten sam jeden pips
robił sześć razy więcej powietrza na sześciopokojowym kadłubie niż na
jednopokojowym. A zużycie było stałą liczbą na pokój — wszystko jedno, czy stało
w nim trzech ludzi, czy nikt. **Załoga nie wchodziła do rachunku w żadnym
miejscu.** Stąd obserwacja gracza: *„jeden pips utrzymuje caly statek
w nieskonczonosc"*.

Teraz jest **jedna produkcja, jedno zużycie, jeden bilans** — liczony raz na
kadłub w `OxygenManager.update`, a pokój dostaje swój udział i **niczego już nie
wylicza sam**.

| kto | oddech/s |
|---|---|
| załogant | 0.04 |
| kot | 0.02 |
| szczur | 0.01 |
| **pająk** | **0** — nie oddycha (update79) |

**`PER_POWER = BREATHING * 3`**, wypisane jako mnożenie, nie jako 0.12. Jeden
pips to dokładnie trzy gęby — liczba gracza — i zmiana tego, ile bierze
człowiek, nie może po cichu zostawić modułu karmiącego dwóch albo czterech.

**Zero pająka nie jest wierszem w tabeli oddechu.** `breathPerSec()` pyta
najpierw `breathes()`, które czyta `SUIT_AIR.NO_LUNGS` — jedno miejsce mówi, że
pająk nie ma płuc, a nie dwa, które mogłyby się rozjechać.

**Jak rozkłada się bilans.** Nadwyżka ląduje tylko tam, gdzie jest na nią
miejsce: pompowanie do komór, które są już pełne, wyrzucałoby wyjście modułu
i sprawiało, że przewietrzona ładownia wraca sześć razy wolniej na
sześciopokojowym kadłubie — czyli **ta sama zależność od rozmiaru, którą ta
paczka kasuje, w drugą stronę**. Deficyt schodzi ze wszystkich, bo statek ma
jeden obieg powietrza.

**Skutek uboczny, świadomy:** martwy moduł opróżnia teraz statek **wolniej na
większym kadłubie** (58 s na skautcie, 92 s na fregacie z trójką załogi),
bo większy statek naprawdę mieści więcej powietrza. update54 stroił 25 sekund
na pokój — ale ta liczba wyglądała groźnie tylko dlatego, że ignorowała resztę
statku. Napięcie bierze się teraz z tego, że **deficyt jest realny i stały**,
a nie z krótkiego zegara.

### 2. MEDBAY — co drugi poziom nowa kuracja

| poziom | co dochodzi |
|---|---|
| 1 | punkty życia (to, co ward robił zawsze) |
| **3** | **zaraza trupia** |
| **5** | **wirus pająka** |
| 7, 8 | zarezerwowane, celowo puste |

`maxLevel` zostaje **8**. Puste szczeble nie są przeoczeniem: poziom, którego
nie umiesz jeszcze wykorzystać, to poziom, którego trafienie nie zabierze.

**`wardLevel()` to `min(zbudowane, zasilane)`** — ta sama formuła, którą
karbonit liczy płyty od update77. Tnie w obie strony i gracz prosił o obie:
trafienie zabiera ławkę kwarantanny **w środku walki**, ale **poziom 5 z jednym
rozbitym pipsem to dalej poziom 4**. To jest dokładnie ten argument za kupowaniem
ulepszenia wcześniej: *„nawet jak nie ma wystarczajaco energi do modulu to warto
miec nieraz wyzszy poziom aby w razie uszkodzenia paipa dalej mozna bylo
uzywac"*.

**Kuracja to CZAS, nie przycisk.** Dwadzieścia sekund na stole. Wyleczenie
w klatce, w której wszedł, zrobiłoby z poziomu 5 wyłącznik i z niesienia chorego
— rzecz darmową; cały koszt leczenia to sekundy, w których jego ręce nie są przy
konsoli. **Wyjście resetuje zegar** — leczenie nie jest czymś, co się odkłada
w ratach między walkami. Zegar **nie jest zapisywany**: przeładowanie cofa go na
początek, co kosztuje gracza czas i nigdy nie może mu go dać.

**Ustępstwo, które trzeba odnotować.** Ukąszenie pająka było *„zegarem, którego
nie da się wykupić"* — jedyną kuracją była placówka badawcza. Poziom 5 to bardzo
duża inwestycja i to jest to, co za nią kupujesz; karbonit (77) dalej jest
odpowiedzią dla tych, których na to nie stać.

**I chory przestał uciekać ze stołu.** Zaraza każe człowiekowi wędrować po
pustych pokojach, a czasem prosto do śluzy (update42, i to zostaje) — więc
w chwili, gdy sala umiała leczyć zarazę, pacjent z niej wychodził. Pierwszy
przebieg testu złapał **siedem sekund dwudziestosekundowej kuracji w czterdziestu
sekundach gry**. Warunek to `_cureT > 0`, który i tak już jest liczony i jest
prawdziwy wyłącznie wtedy, gdy człowiek leży w sali umiejącej wyleczyć to, co ma
— więc pytanie kosztuje jedną linijkę, a nie drugą kopię „czy on jest leczony".

### 3. Ze zrzutu ekranu: lewa kolumna i reaktor walczyły o ten sam pasek

Trzy rzeczy mieszkają w tym samym 130-pikselowym pasku po lewej: lista załogi,
panel rozkazów i **kolumna pipsów reaktora**. Reaktor rośnie **w GÓRĘ** z dolnego
paska (przy pojemności 16 najwyższy pips sięga y=412), lista rośnie **w DÓŁ**.
**Nic nigdy nie mówiło, kto komu ustępuje** — i przy karcie 26 px i trzyosobowej
załodze nigdy się nie spotkały.

update80 dał karcie 42 px na pasek znaczników. Ta paczka posadziła siedem gęb na
fregacie, żeby popatrzeć, jak schodzi powietrze — i zrzut pokazał nagłówek panelu
rozkazów wydrukowany **przez pipsy**: `NO S[pipsy]CIALISATIONS`.

Teraz obie strony o sobie wiedzą, w jednym miejscu:

- **`leftColumnFloor(ship)`** liczy górę kolumny reaktora **tą samą arytmetyką**,
  którą `_drawPowerBar` ją rysuje. Jedno ruszy się bez drugiego tylko wtedy, gdy
  ktoś zmieni `_H`, a wtedy ruszą się oba
- **`orderPanelHeight()`** wyprowadzona z tego samego układu, którym
  `orderRects` rozkłada przyciski — dowódca z ośmioma rozkazami specjalnymi
  potrzebuje dwóch rzędów więcej, a magiczne „152" chowałoby załoganta, żeby
  zrobić miejsce przyciskom, których nie ma
- **panel rozkazów jest zakotwiczony**, a nie doczepiony do końca listy —
  przy okazji przestaje wędrować po ekranie przy każdej rekrutacji i każdej
  śmierci, czyli ręka ma stały cel
- **kto się nie mieści, jest POLICZONY**: `+2 MORE`. Lista, która po cichu kończy
  się na piątym człowieku, to lista, której gracz nie może ufać

**To jest łata, nie rozwiązanie**, i gracz przewidział ten moment słowami *„jak
bedzie mocno przyszkadzalo to zmienimi pomyslimy cos lepszego"*. Przy 4-5
ludziach i normalnym reaktorze nic się nie chowa; przy ośmiu i dużym reaktorze
zobaczy `+3 MORE`.

**I jedna linijka SKASOWANA, bo nie dało się jej zepsuć.** Pierwsza wersja
klamrowała jeszcze pozycję panelu przez `Math.min(crewY + 2, listEnd)` — pas
do szelek. Przebieg łamiący nie umiał tego złamać, bo **klamra nie może nigdy
zadziałać**: `fits` jest wyliczone z `listEnd`, więc ostatnia karta plus linia
`+N MORE` zawsze kończą się przed nim o resztę z dzielenia. Drugi strażnik,
który nie może wystrzelić, to linijka, którą następny czytelnik musi obalić.

### 4. Testy

Sekcje **262** (drabina sali) i **263** (podłoga lewej kolumny), plus **sekcja
171 przepisana w całości** — jej dwie asercje sterowały pokojem bezpośrednio
(`o2.update(0.05, 0, …)`) i po zmianie modelu **nie mierzyły już niczego**:
druga pozycja to dziś stopa netto, więc zero znaczyło „nic się nie dzieje",
a jedynka „napełnij natychmiast". Nowa wersja prowadzi STATEK.

**17 rewertów `#82`, wszystkie złapane.** Pierwszy przebieg puścił trzy i każdy
z innego powodu:

- **strażnik wędrówki** — moje testy PRZYPINAŁY pacjenta do sali, więc skasowanie
  strażnika nic nie zmieniało. Teraz asercja jest na **zegarze wędrówki**
  (`_infT`), nie na tym, gdzie chory skończył: test czytający jego pokój
  czytałby rzut kostką
- **stawki oddechu** — wiedziałem, ile bierze kot, ale nic nie sprawdzało, czy
  BILANS o to pyta. Teraz trzy kadłuby: trójka ludzi, trójka z kotem i czwórka —
  kot musi wypaść **dokładnie w połowie**
- **rozkład nadwyżki** — wszystkie pokoje w moich testach były równe, więc
  `net/pokoje` i `net/pokoje-z-miejscem` dawały to samo. Teraz jedna
  przewietrzona ładownia na pełnym statku, przy zamkniętych drzwiach

### 5. Pułapka: `effectivePower` zawiera cyborga

Test zszedł salę do dwóch pipsów i **czasem** leczyła zarazę mimo to: `makeStartingCrew`
jest losowe, a **cyborg Terry leżący w sali daje +1**, więc sala poproszona
o dwa chodziła na trzech. To jest poprawne zachowanie gry i **błędny test** —
najuczciwsza możliwa kolejność. Teraz schodzi do jednego pipsa.

### 6. Czego tu NIE ma

- **kot na rozkaz** — update83
- **szkodniki do wentylacji** — update84; dopiero wtedy szczur zacznie realnie
  kosztować powietrze, bo dziś rzadko jest ich wielu naraz

## 5-0w. ZMIANY update81 (JEDZENIE)

**To jest ODWRÓCENIE update69** i warto napisać dlaczego, bo update69 skasował
automatyczne jedzenie z dobrego powodu.

**Skarga gracza wtedy:** *„jedzenie jest dalej zjadane automatycznie a nie
powinno"* — głodny sięgał do ładowni sam, więc cztery rodzaje racji, rozkaz FEED
i decyzja o tym, co zabrać, były **dekoracją**. Ładownia pustoszała, czy gracz
patrzył, czy nie.

**Jego polecenie teraz:** *„wrocimy do mechaniki ze jak jest jedzenie w ladowni
to w momecie jak sa glodni automatycznie jedza, poczawszy od najgoryszych potraw
po lepsze, oczywiscie dalej mozesz dac rozkaz jedzenia zalagantowi manualnie"*.

**Co się zmieniło pomiędzy — i dlaczego to nie jest ten sam błąd:**

| paczka | co dołożyła |
|---|---|
| **70** | głód ma **ŚRODEK** — głodny pracuje wolniej, więc racja kupuje coś poza „nie umrzeć" |
| **78** | posiłek **TRWA** |
| **79** | **zajęty nie stoi przy konsoli** — więc automatyczny posiłek kosztuje sekundy pracy w środku walki; to cena, nie ciche odjęcie |
| **81** | je się **NAJGORSZE** pudełko — dobre racje wciąż leżą na półce, gdy gracz decyduje, komu je dać |

**FEED zostaje i zostaje dokładnie taki, jaki był.** Automat zabiera KLIKANIE,
nie wybór.

### 1. Najgorsze pudełko pierwsze

To jest odwrotność tego, co robi gracz ręcznie, i o to chodzi. Automatyczna gęba
zjada pastę proteinową, która i tak by się zmarnowała; **racje polowe i dobre
zestawy są tam, gdy TY decydujesz, kto je dostaje**. Jedzenie od dołu jest też
jedyną kolejnością, która czyni z czterech racji **decyzję pakowania**, a nie
listę zakupów.

| racja | sytość | kolejność |
|---|---|---|
| Protein Paste | 25 | pierwsza |
| Ration Pack / Green Ration | 50 | potem |
| Field Meal | 80 | ostatnia |

Wartość czytana jest **z samego pudełka** (`def.hunger`), więc nie może się
rozjechać z tym, ile posiłek naprawdę daje.

### 2. Walka przed jedzeniem, ale pożar nie

**Nikt nie otwiera racji w pomieszczeniu, w którym stoi abordażysta** — ten sam
predykat (`roomContested`), który zatrzymuje resztę pracy w pokoju, zatrzymuje
i to. Dzięki temu „bijatyka wywłaszcza wszystko" ma na tym statku **jedną**
odpowiedź.

**Gaszenie pożaru go NIE zatrzymuje** i to jest decyzja gracza: *„zostawi
gaszenie czy zazadzanie modulem na rzecz jedzenia"*. Głód przebija węża. Nie
przebija człowieka, który właśnie go bije.

### 3. Zajęte ręce nie pracują

Zegar zajętości był czytany w coraz większej liczbie miejsc — pasek znaczników
od 78, `crewOperating` od 79 — a **`_updateTask` był ostatnią pętlą, która o nim
nie wiedziała**. Więc człowiek mógł jeść rację i gasić pożar **tą samą parą
rąk**: to jest skarga gracza na odwrót, bo połowa „zostawi" nigdy się nie działa.

**WSTRZYMANE, NIE ANULOWANE.** Zadanie zostaje przypisane, więc po posiłku
wraca do pożaru, który zostawił. To jest znaczenie słowa „na chwilę" — i jedyna
wersja, która nie może zgubić rozkazu.

### 4. JEDEN wybierak posiłku — i przy okazji znaleziony bug

`_startMeal` (droga kota i teraz automatu) miał **własną kopię** wyboru: jajo,
a jak nie, to pierwsza racja w kolejności siatki. Rozkaz FEED pytał `mealFor`.
Dwie odpowiedzi na „co ta gęba otworzy jako następne" — i **nie zgadzały się co
do jaja**: kot brał je sam, a FEED mówił graczowi *„nothing aboard she will
eat"*. Jeden wybierak, jajo w nim.

**Jajo nie jest kursem na drabinie, tylko ją przeskakuje.** Kot bierze jajo
przed wszystkim innym i to nie jest opinia o smaku: **jajo zostawione
w ładowni się WYKLUWA**, a kot, który je zjada, to walka, która się nie odbywa.
Załoga jaj nie tyka w ogóle i ta reguła mieszka w `willEat`, nie tutaj.

### 5. Czego tu NIE ma

- **poziomy medbayu i tlen jako budżet** — update82 (medbay **co 2 poziomy**:
  3 lv zaraza, 5 lv wirus; `maxLevel` zostaje 8)
- **kot na rozkaz** — update83

### 6. Testy

Sekcja **261**, plus **przepisany blok z update69**, który twierdził dokładnie
coś odwrotnego. Przepisanie zachowało tę połowę, która nigdy nie była o tym,
kto decyduje: **posiłek kosztuje JEDNĄ sztukę z paczki, nie całe pudełko** —
oraz dołożyło drugą, o którą aż się prosi przy automacie: **człowiek, który
zjadł, przestaje jeść**. Automat opróżniający ładownię jednym przebiegiem to
skarga z update69 wracająca tylnymi drzwiami.

**8 rewertów `#81`, wszystkie złapane.** Pierwszy przebieg puścił jeden i to
**rewert był zły, nie test**: „niech jajo liczy się jako kurs na drabinie" nie
psuło niczego, bo pasta (25) i tak sortuje się przed jajem (60), a `_startMeal`
brało jajo osobną gałęzią. Szukanie, dlaczego rewert nic nie psuje,
**doprowadziło do prawdziwego buga** — rozjazdu między kotem a FEED opisanego
w §4. Naprawiony, z własnym testem.

### 7. Pułapki

- **`cargo.countOf(kind)` odpowiada po `def.kind`, a każda racja to
  `kind: 'food'`** — więc `countOf('protein_paste')` jest ZAWSZE zerem i test
  na nim zbudowany nie mierzy niczego. Do liczenia sztuk jednego pudełka jest
  filtr po `defKey`, i sekcja 261 ma go u góry jako `units()`
- **`cargo.add(key)` dokłada CAŁY STOS** (pasta 5, field meal 4), nie jedną
  sztukę
- **`damagedLevels` to liczba całkowita**, a poziom wraca kilkadziesiąt sekund —
  nie drgnie w trakcie trzysekundowego posiłku, więc asercja na nim byłaby
  prawdziwa niezależnie od tego, czy człowiek pracował. Mierzalny jest
  `repairProgress`

## 5-0x. ZMIANY update80 (CO WIDAĆ NA EKRANIE)

**Cała paczka to jedno zdanie gracza:** *„wtedy gracz spojzy na zaloganta na
liscie i wie wszytko co sie dzieje w danym momecie"*. Do tego dwa liczniki na
górnym pasku i pocisk, który wreszcie wychodzi z lufy.

### 1. JEDEN zestaw ikon zamiast dwóch — to jest właściwa robota

Te same trzy fakty były rysowane **dwa razy, w dwóch plikach, w dwóch
językach**:

| gdzie | czym było |
|---|---|
| nad głową na pokładzie (`crew.js`) | menażka z elipsy i dwóch linii, butla z prostokąta i wypełnienia, pierścień ze znakiem `☣` w środku |
| w wierszu na liście (`renderer.js`) | znaki tekstowe `▼`, `☣`, `✚`, `◓` |

Dwa obrazki jednej rzeczy — i każda przyszła zmiana ikony to zmiana w dwóch
miejscach, z czego o jednym ktoś kiedyś zapomni. Gracz poprosił wprost: *„uzyj
tych samych co sa nad zalogantami w statku, ta sama ikonka glodu i brak
powietrza co jest"*.

**`STAT_ICONS` już istniało** — siatka 10 × 10, renderer na canvas ORAZ
renderer do SVG dla sklepu. Trzeba było nie wymyślać zestawu, tylko **wpisać
się do istniejącego**. Doszło jedenaście ikon: `hunger`, `eating`, `air`,
`repair`, `fire`, `breach`, `fight`, `plague`, `medical`, `frozen`, `away`.

Teraz **pokład woła `Renderer.crewMarks`** — tę samą funkcję, co lista — i maluje
to, co dostanie, tym samym `drawStatIcon`. Ręcznie rysowane kształty
skasowane. Zostaje jeden wyjątek i jest uczciwy: znacznik **modułu** dalej jest
glifem, bo „który to moduł" odpowiada `SYSTEM_GLYPHS`, a to już jest jedna
tabela czytana wszędzie.

**Pokład pokazuje mniej niż lista, i to jest decyzja**, nie niedoróbka:
`CrewMember.DECK_MARKS` to jedna lista powolnych zabójców (dwie choroby, pusta
butla, pusty żołądek). Klucz nad każdą głową w zabieganym kadłubie to szum,
a lista i tak to niesie.

### 2. Pasek znaczników mówi WSZYSTKO

Doszły cztery rzeczy, których gracz nie miał jak zobaczyć bez znalezienia
człowieka na pokładzie i odczytania jego animacji:

| znacznik | kiedy |
|---|---|
| ⚒ **naprawia** | `TASK.REPAIR` |
| 🔥 **gasi pożar** | `TASK.FIRE` |
| ▣ **łata wyłom** | `TASK.BREACH` |
| ⚔ **walczy** | w pokoju stoi abordażysta |
| 🜂 **brak powietrza** | ta sama liczba, którą pyta butla nad jego głową |

**Walka przebija wszystko inne — i to jest pytane STATKU, nie animacji.**
`CrewMember.update` pozwala bijatyce wywłaszczyć każde zadanie i wychodzi
z funkcji, zanim zadanie ruszy, więc człowiek machający kluczem francuskim po
abordażyście **dalej ma `task = REPAIR` w polu**. Panel, który drukowałby to
pole, kłamałby dokładnie w tej chwili, którą gracz ogląda najuważniej. Pytanie
idzie do `roomContested` — tego samego predykatu, który zatrzymuje resztę pracy
w pokoju.

### 3. Jedna linia, większe ikony

Decyzja gracza: *„narazie zrob w jednej lini wszytkie, no i wieksze niz sa
teraz"*, przy panelu **tej samej szerokości**.

Pasek był 2 × 2 w 28-pikselowej rynnie między kartą a panelem szczegółów —
mieściły się dokładnie cztery znaczniki, a człowiek może ich mieć teraz osiem
naraz. Więc pasek **zszedł do środka karty**, w osobną linię pod punktami
życia, i biegnie stamtąd do `CREW_PANEL_X`. To 124 px, osiem znaczników po
piętnaście. Ikony **10 → 14 px**. Karta jest wyższa; panel nie jest szerszy,
bo to była ta granica, która się liczyła — plansza zaczyna się tam, gdzie
kończy się panel.

`MARK_MAX` zostaje jako **bezpiecznik, nie zasada układu**: nic nie powinno
wyprodukować więcej niż osiem, a gdyby coś wyprodukowało, pasek się urywa
zamiast malować po planszy.

### 4. Opatrunki i jedzenie na górnym pasku

Pasek od zawsze nosił dwie rzeczy, które cię unieruchamiają — paliwo i głowice
— i żadnej z dwóch, które zabijają załogę. Czytane **prosto z ładowni**, jak
odczyt He-3 od update58 i z tego samego powodu: kratki SĄ ilością, więc nie ma
drugiej liczby do trzymania w zgodzie. Dawki z `doseCount()` — tej samej
funkcji, przeciw której płaci opatrunek i medikit, więc odczyt i reguła nie
mogą się rozjechać.

Przy zerze **przygaszone, nie schowane**. Odczyt, który znika, to odczyt,
którego gracz nigdy nie nauczy się szukać — a „nie ma dawek" to dokładnie ta
chwila, w której musi go zobaczyć.

### 5. Pocisk wychodzi z lufy

Układ mountów był **zmienną lokalną `gx` w pętli rysującej**, a strzał wychodził
z `roomBounds().x + w + 10` — z rogu prostokąta otaczającego CAŁY statek. Czyli
działo było rysowane wzdłuż górnej krawędzi, a strzelało z boku, i **każde
działo na pokładzie strzelało z tego samego piksela**, wszystko jedno w której
komorze stało. Dwie pozycje jednego działa, w dwóch plikach, które nigdy się
nie spotkały.

`Ship.weaponMounts()` odpowiada teraz raz, a czytają to i rysunek, i pocisk
(`muzzleFor`). **Wróg też** — ta sama funkcja, więc zasada nie brzmi „strona
gracza wygląda dobrze".

**I wiązka.** Była poziomą belką rysowaną W POPRZEK celu, zaczynającą się przy
krawędzi celu — broń bez źródła, niewidoczna jako wada tylko dlatego, że każdy
strzał i tak wychodził z tego samego miejsca na burcie. Teraz idzie **od lufy
do miejsca, do którego doszło cięcie**, i obraca się, gdy cięcie wędruje wzdłuż
kadłuba.

### 6. Ze zrzutu ekranu: pięć ikon nie do odczytania

Arkusz wyrenderowany w **prawdziwym rozmiarze 14 px obok powiększenia** —
i pięć z jedenastu trzeba było przeprojektować:

| ikona | co pokazał zrzut | co jest teraz |
|---|---|---|
| `plague` | trójlistek trzech kółek zlał się w **ludzika** | wirion: pełny rdzeń i osiem kolców |
| `fire` | symetryczna kropla czytała się jako **pomarańczowy romb** | płomień pochylony, z wcięciem z jednej strony |
| `fight` | skrzyżowane ostrza = **czerwony X**, czyli „anuluj", i najgłośniejszy element panelu, bo X wypełnia całe pole |  dwa groty schodzące się do siebie |
| `repair` | otwarta szczęka klucza = **lizak** | młotek: pełna głowica na ukośnym trzonku |
| `breach` | pełna plama w ramce = „pudełko z czymś w środku", odwrotność dziury | zygzak pękający płytę |

Reguła, która z tego wyszła i warto ją zapamiętać: **przy 14 px symetria zabija
sylwetkę, a trzy podobne kółka zlewają się w kończyny.** Czytelne są rzeczy,
których części nie trzeba od siebie odróżniać.

### 7. Czego tu NIE ma

- **jedzenie automatyczne** — update81
- **poziomy medbayu i tlen jako budżet** — update82 (medbay **co 2 poziomy**:
  3 lv zaraza, 5 lv wirus; `maxLevel` zostaje 8)
- **kot na rozkaz** — update83

### 8. Testy

Sekcja **260**, plus przepisane dwie asercje z update76, które ta paczka
świadomie unieważnia (znacznik nie jest już znakiem tekstowym; pasek nie jest
już „z boku"). Każda przepisana zachowuje to, co naprawdę mierzyła:
*czy chorego widać* i *czy pasek nie wchodzi pod panel szczegółów*.

**20 rewertów `#80`, wszystkie złapane.** Pierwszy przebieg puścił dwa i oba
są warte zapamiętania:

**(a) Test przechodził, bo szukał napisu „8" GDZIEKOLWIEK na pasku.**
Asercja brzmiała „wydaj dwie dawki, pasek pokazuje 8" i była napisana jako
`bar().includes('8')`. Na budowie z odczytem zabitym na sztywno (`doses = 10`)
dalej przechodziła — bo **licznik rakiet akurat tej klatki też pokazywał 8**.
Teraz twierdzenie jest o ZMIANIE: po wydaniu dwóch dawek **dokładnie jedna
liczba na pasku się rusza, z dziesięciu na osiem**.

**(b) Strzał wroga nie był mierzony w ogóle**, a to inna ścieżka kodu niż
`playerFire` i miała własną kopię rogu. Dopisanie testu wymagało dwóch lekcji:
statki trzeba tykać osobno (`CombatManager.update` prowadzi AI i pociski, ale
**nie ładuje dział** — to robi `Ship.update`, czyli w grze pętla główna), a AI
trzeba potem prowadzić SAMO, bo `update` wystrzeliwuje pocisk i **w tej samej
klatce go przesuwa** — pierwsza wersja testu czytała pocisk już w locie
i porównywała go z lufą.

## 5-0y. ZMIANY update79 (WALKA W MODULE)

**Cztery zgłoszenia z żywej gry, jeden bug i jedno stare ustalenie, które
nigdy nie weszło.** Wszystko dotyka jednej rzeczy: bijatyka w module była zbyt
prosta, żeby dało się nią dowodzić.

### 1. Trzy miejsca NA STRONĘ, nie trzy na pokój

Były **dwie odpowiedzi na to samo pytanie i nie zgadzały się ze sobą** —
obie wypisane ręcznie przy dwóch miejscach klikania:

| gdzie | filtr | skutek |
|---|---|---|
| na własnym kadłubie | tylko `alive` | dwóch abordażystów w medbayu i możesz wysłać **jednego** medyka |
| na wrogim kadłubie | `isPlayer` | trzech twoich wchodzi do pokoju, w którym stoi już czterech obrońców |

Gracz spotykał obie w jednej walce. Teraz jest jedna funkcja — `roomSpaceFor`
— i to ona odpowiada obu kliknięciom. **Trzech twoich i trzech ich, sześciu
w bijatyce**, i żadna strona nie może zamknąć drugiej przed wejściem.

`Ship.ROOM_SLOTS` to teraz **jedna liczba** na całą grę: rozmiar drużyny
abordażowej (naszej i ich) i pojemność modułu to ta sama liczba, bo to ta
sama zasada — tylu, ilu zmieści się w pokoju, do którego wchodzą.

**Przy okazji: obcy nie trzyma już naszej konsoli.** `takenStationSlots`
nie miało żadnego filtru strony, więc człowiek, który przyszedł zabić twojego
strzelca, stał na jego konsoli i spychał go na bok własnej komory. Przy trzech
miejscach to była usterka kosmetyczna; przy sześciu ludziach obie strony
miałyby **trzy miejsca do podziału** i przegrany wyścigu nie stałby nigdzie.

**I skasowana jedna martwa gałąź.** `stationSpot(room, occupants)` miała
drugi sposób wyboru miejsca — przez liczenie głów zamiast pytania, które
miejsca są zajęte. Od wielu paczek nikt nie wołał jej z liczbą; obaj
wywołujący podawali `null`. Druga, nieosiągalna odpowiedź na pytanie, które
ma już jedną, jest gorsza niż brak kodu.

### 2. Rannego da się podmienić jednym kliknięciem

Zgłoszenie gracza: *„brak podmienienia zalogantow na kogos kto ma wiecej hp,
a tego z mala iloscia aby muc wyslac do medbay"*. To były dwa rozkazy, których
**nie dało się wydać obu**: moduł odmawiał świeżemu, póki ranny w nim stał,
a wyprowadzenie rannego najpierw zostawiało komorę pustą pod ostrzałem.

Jedno kliknięcie robi teraz obie połowy — i **tylko wtedy, gdy to poprawa**:
wychodzi **najbardziej ranny**, i tylko dla kogoś w lepszym stanie niż on sam.
Podmiana zdrowego na zdrowszego byłaby grą przestawiającą załogę za plecami
gracza.

Idzie do medbayu, jeśli kadłub go ma — o to w tym rozkazie chodzi — a jeśli
nie, **do dowolnej innej komory z miejscem**. Oba statki startowe medbayu nie
mają, więc to nie jest przypadek egzotyczny, tylko typowy: „nie ma sali" nie
może znaczyć „zostaje w walce".

### 3. Bijatyka to pojedynki, nie ostrzał skupiony

Każdy walczący bił w `foes[0]` — **pierwszego z tablicy**. Trzech na trzech
to nie były trzy pojedynki, tylko sześciu ludzi tłukących po jednym człowieku
na stronę; ten padał i pałeczkę przejmowało następne nazwisko na liście.

Obie strony są teraz **sortowane po id i parowane po pozycji** — i-ty nasz
bierze i-tego ich. Wypadają z tego trzy własności i wszystkie trzy są
potrzebne:

- **wzajemność** — jeśli jestem drugi u siebie i biorę ich drugiego, on jest
  drugi u siebie i bierze mnie. Nikt nie okłada człowieka odwróconego plecami
- **stabilność** — nikt nie zapamiętuje przeciwnika, nie ma zegara, a para
  przeżywa klatkę, bo wynika z **kolejności obu rosterów**, nie z tego, kto
  akurat stoi bliżej
- **nadmiar pomaga** — czterech na trzech i czwarty zawija się do pierwszej
  pary. Dwóch na jednego. *„jezeli jest przewaga to jeden wolny pomaga innemu
  w walce"* — i to sprawia, że **przewaga liczebna bije jednego bohatera**,
  czyli że abordaż ma kształt abordażu

Komparator działa na **napisie** z id celowo: id są dziś liczbami, ale
przychodzą z pliku zapisu, a odejmowanie na starym id-napisie daje `NaN`,
co po cichu rozsortowałoby jedną stronę i zabrało wzajemność.

### 4. Wróg wysyła do trzech i nigdy nie zostawia pustego kadłuba

Było wpisane jako `-2` na jednym końcu pliku, podczas gdy nasza drużyna miała
`0, 3` na drugim. Kontratak abordażowy był więc walką wygraną arytmetyką,
a nie grą. Oba końce czytają teraz `Ship.ROOM_SLOTS`. Zawsze zostawiają kogoś
na pokładzie: pusty kadłub to derelikt, a „drużyna abordażowa", która porzuca
własny statek, to inne zdarzenie z innym zakończeniem.

### 5. Pająk nie oddycha

Ustalenie z **17.09** (§U10: *„pająki … odporne na brak tlenu; zabija je tylko
ogień albo kot"*), które **nigdy nie zostało zaimplementowane** — przez trzy
paczki dokument projektowy i kod mówiły co innego i nikt tego nie zauważył, bo
szkodników nie ruszaliśmy. Gracz zapamiętał i zapytał; kod był w błędzie.

`SUIT_AIR.NO_LUNGS` to **inne pytanie niż `TANK: 0`**. Zero w butli znaczy
„nie ma zapasu" — szczur ginie w chwili, gdy komora pójdzie. To tu znaczy
„nie chce powietrza w ogóle".

To nie jest drobiazg: **wypuszczenie powietrza to tania odpowiedź na wszystko,
co zalęgło się w kadłubie**, i póki działała na pająki, pasożyt z wirusem
i jajem był usuwany tym samym kliknięciem co szczur. Zostają ogień i kot —
i to jest to, co czyni kota wartym racji żywnościowych.

### 6. BUG: duplikacja chipów CPU — skasowany drugi rejestr

Zgłoszenie: *„jak dodaje cpu to zostaje w inwentory cpu ale ten co byl zostaje
w inwentory, moge dodac znow ten sam i mam 2 w cpu u kapitana i dalej
w inwentory."*

**Samo przełożenie nigdy nie było błędne** — jedna siatka traci przedmiot,
druga zyskuje. Chip wracał dlatego, że `Base.storeGrid()` to **czytnik, a nie
akcesor**: przy każdym wywołaniu deserializuje NOWĄ siatkę z NOWYCH obiektów.
Ekran bazy trzymał swoją kopię półki, ekran CPU czytał własną, i wygrywał ten,
kto zapisał się ostatni — a zapisywał się ostatni ekran bazy, przy najbliższym
LAUNCH albo zamknięciu magazynu.

Naprawa to **jeden obiekt**: `BaseScreen.liveShelf()`. Cokolwiek otwiera się
z bazy, **pożycza tę półkę**, zamiast czytać własną. Nie ma drugiej kopii,
która mogłaby się zestarzeć.

### 7. Sześciu ludzi w module musi być CZYTELNE — ze zrzutu ekranu

Tego nie było w planie i nie mogło wyjść inaczej niż ze zrzutu. Trzech
najeźdźców stojących między trzema twoimi ludźmi dało:

- **trzy etykiety z imionami malowane jedna na drugiej ORAZ na imionach
  twoich ludzi** — dosłownie `Raider 2dcRaider 3`
- **paski życia** (24 px przy rozstawie 13 px) zlane w **jedną długą zieloną
  kreskę** przez cały moduł

Nic tego wcześniej nie mierzyło, bo sześciu w module było niemożliwe.

Najeźdźca **nie ma już etykiety z imieniem**. To nie jest nowa zasada — to ta
sama, której używa znacznik ciała dwadzieścia linijek wyżej („kto to leży"
pytasz tylko o swoich); etykieta stojącego jej po prostu nie dostała. Imię
najeźdźcy nie jest informacją, na której się działa. Imiona twoich ludzi są.

Jego pasek życia jest **pod nogami** — osobny rząd. Pierwsza wersja
przeniosła go do góry i **druga wersja zrzutu pokazała, że wylądował na
imionach `Echo` i `Mira`**: jedna kolizja zamieniona na drugą.

### 8. Czego tu NIE ma

- **pełny zestaw ikon statusu i większe ikony** — update80
- **pociski z działek** i licznik opatrunków/jedzenia na górnym pasku — update80
- **jedzenie automatyczne** — update81
- **poziomy medbayu i tlen jako budżet** — update82 (medbay **co 2 poziomy**:
  3 lv zaraza, 5 lv wirus; `maxLevel` zostaje 8)

### 9. Testy

Sekcje **257** (moduł i bijatyka), **258** (jedna półka w bazie) i **259**
(drużyny abordażowe). **18 rewertów `#79`, wszystkie złapane.**

**Pierwszy przebieg puścił PIĘĆ**, i cztery z nich miały tę samą przyczynę:
test mierzył funkcję, a nie DROGĘ, którą gracz do niej dociera.

| co przeciekło | dlaczego | co teraz |
|---|---|---|
| pojemność na własnym kadłubie | testowałem `roomSpaceFor`, nie kliknięcie | rozkaz wydany przez `_crewClickResolve` |
| pojemność na wrogim | to samo | to samo, plus dwóch naszych już w pokoju |
| podmiana rannego | testowałem `_relieveInRoom` wprost | rozkaz przez kliknięcie |
| `foes[0]` w pętli bijatyki | testowałem `meleeTarget`, nie pętlę | 300 klatek realnej walki, HP podniesione, żeby nikt nie zginął i nie przecelował walki |

Piąty jest ciekawszy i **rewert był zły, nie test**: „odwróć jedną stronę"
(`.reverse()`) **odwraca parowanie SYMETRYCZNIE**, więc dalej jest wzajemne
i dalej stabilne — inna poprawna odpowiedź, nie zepsuta. Prawdziwym zepsuciem
jest **usunięcie sortowania**, a to widać dopiero na rosterze, którego
kolejność nie jest kolejnością id.

I nawet wtedy **pierwsza tasowanka nie wystarczyła**: `[Z,B,X,C,Y,A]` daje
naszych w kolejności `B,C,A` i ich `Z,X,Y` — **te dwie permutacje wzajemnie
się znoszą**, więc bez sortowania wychodziło inne, ale nadal wzajemne
parowanie. Dopiero `[B,Z,A,X,C,Y]` (jedna permutacja jest swoją odwrotnością,
druga nie) naprawdę łamie wzajemność.

### 10. Nowe pułapki

- **NIGDY nie rób `require('tests/break_check.js')`** — ten plik URUCHAMIA
  się przy załadowaniu. Zrobiłem to raz, żeby sprawdzić składnię, timeout
  ubił go w połowie i **zostawił drzewo z jednym zarewertowanym plikiem**
  (`station.js`), co dało dwa czerwone testy o klinice i kocie. Do sprawdzenia
  składni jest `node --check`. Do znalezienia, który rewert został zastosowany:
  wczytać plik jako TEKST, wyciąć tablicę `BREAKS` i sprawdzić, dla którego
  wpisu `from` nie występuje już w pliku
- **w skryptach Pythona podstawiających kod JS**: `"..." + N + "..."` wewnątrz
  potrójnych cudzysłowów **nie jest konkatenacją**, tylko dosłownym tekstem.
  Wylądowało w pliku i wywaliło `break_check` na `ReferenceError: N`
- **test, który woła funkcję wprost, nie chroni drogi do niej.** Cztery z
  pięciu przecieków tej paczki to dokładnie to
- **rewert może być „inną poprawną odpowiedzią"**, a nie zepsuciem. Jeśli
  łamiący przebieg mówi „nie złapane", pierwsze pytanie brzmi: czy ten rewert
  naprawdę coś psuje?

## 5-0z. ZMIANY update78 (OPATRUNEK ≠ MEDBAY)

**U1 z ustaleń 15.09, klasa bug.** Zgłoszenie gracza brzmiało: *medbay wydaje się
bez sensu, bo opatrunek robi dokładnie to samo*. Robił. Opatrunek polowy kończył
się tym samym zdaniem co moduł za tysiąc CC — „wstaje na 30 %" — więc medbay był
szybszym bandażem, a noszenie rannych nie występowało prawie wcale.

Teraz są **trzy różne rzeczy** i każda kosztuje co innego:

| | koszt | krwawienie | wstaje | HP |
|---|---|---|---|---|
| **Opatrunek** (automat) | **1 dawka** | stop | **nie** | zostaje nisko |
| **MEDKIT** (przycisk) | **2 dawki** | stop | **tak** | 30 % |
| **TREAT → medbay** | czas + niesienie | stop | tak | **do pełna** |

**Odstępstwo od projektu z 15.09, na wyraźne żądanie gracza (23.09):** tabela
w §U1 mówiła, że opatrunek jest za darmo. Gracz to odrzucił — *„musi być koszt,
bo tak to nie ma sensu system krwawienia"*. Bez ceny bandaż był darmowym
anulowaniem krwotoku, czyli krwawienie nie było zagrożeniem, tylko opóźnieniem.
Dawki są wspólne z medkitem, więc automat zjada zapas, który gracz trzyma na
postawienie kogoś na nogi — i to jest cały konflikt.

### 1. Jedna apteczka to dziesięć dawek, nie jeden bandaż

`medkit` był już w ładowni jako kratka 1 × 1 ze stosem do 10. Niczego nie
dokładałem: **liczy się dawki, nie pudełka.** `doseCount / hasDoses / spendDoses`
to jedyne trzy funkcje, które o tym wiedzą, i spendDoses płaci **wszystko albo
nic** — nigdy połowy dawki. Jedno pudełko = 10 opatrunków albo 5 medkitów.

### 2. Zegar zajętości — jeden na wszystko

Każda z nowych czynności trwa (żądanie gracza: *„wszystkie czynności powinny
zajmować chwilę czasu, 2-3 s"*). Zamiast trzech liczników **jeden**: `_busyT`,
`_busyAct`, `_busyOn` i `get busy()`. Koniec czynności rozgałęzia się raz,
w `_busyTick`, na `_finishMeal` / `_finishAid` / `_finishMedkit`.

Dwa liczniki tej samej rzeczy zawsze się rozjadą, a pytanie „czy on ma teraz
wolne ręce" ma mieć **jedną** odpowiedź — dla jedzenia tak samo jak dla bandaża.

### 3. Zajęty człowiek nie jest przy konsoli

To zostało dorobione **po zrzucie ekranu**, bo przez pół paczki zegar istniał
i nikt go nie czytał: strzelec mógł zjeść rację i dalej być strzelcem, medyk
mógł klęczeć nad rannym i dalej pilotować. Stanie w pokoju było całym testem.

`crewOperating()` jest **jedynym** miejscem odpowiadającym „kto tu pracuje", więc
jedyna zmiana jest tam — a koszt wypada sam we wszystkich trzech miejscach naraz:
działo milknie, cyborg traci swoje +1, glif modułu znika z paska znaczników. To
jest ta sama zasada co zawsze: jeden rejestr, nie trzy zgodne przez przypadek.

### 4. Medbay dostał swoją jedyną robotę — i jedną listę pacjentów

Były **dwie** pętle leczenia: ta w `ship.js` leczyła leżących, druga, w
`ShipSystem.update`, leczyła stojących. Dwie połowy jednej listy w dwóch plikach,
w dwóch tempach, zgodne wyłącznie przez przypadek — a `medbayPatients`, jedyna
funkcja nazwana od odpowiedzi, **nie była podpięta do żadnej z nich**. Druga
pętla skasowana, `medbayPatients` zwraca teraz zdolnych i leżących, i pętla
leczenia pyta właśnie ją.

Przy okazji wyszło, że pacjent leżący w sali **liczył się jako operator modułu** —
losowy cyborg Terry na noszach trzymał salę zapaloną bez prądu. Medbay ma teraz
`crewOperating` jak każdy inny moduł, a pacjentów osobno.

### 5. Ranny na stole nie umiera przy włączonym module

Zegar krwotoku nie wiedział nic o leczeniu, więc człowiek doniesiony do medbayu
potrafił wykrwawić się na stole. `_wardIsOpen()` — sala jest na pokładzie, cała
i pod prądem — wstrzymuje krwotok. Jedna funkcja, bo pytanie „czy sala działa"
pada teraz w trzech miejscach.

### 6. Medyk odchodzi od człowieka, którego opatrzył

Zgłoszenie znalezione testem: zwolnienie roszczenia ratowniczego działo się
w chwili, gdy ranny **wstawał** — a od tej paczki opatrzony już nie wstaje.
Medyk zostawał przy nim na zawsze. Teraz kończy go `patched`, a dyspozytor nie
wysyła po opatrzonego drugi raz, chyba że jest rozkaz TREAT/MEDKIT albo działa
sala. Inaczej cała załoga chodziłaby w kółko po jednym stabilnym rannym.

### 7. Pasek znaczników mówi, kto jest na zegarze

Też ze zrzutu. Wiersz pisał `INJURED` i opatrzonemu, i wykrwawiającemu się —
a gracz ma właśnie na tej różnicy wydawać dawki. Bez znacznika „kto zaraz
umrze" było zgadywanką.

| znacznik | co znaczy |
|---|---|
| `✚` czerwony, pulsuje | KRWAWI — jest na zegarze |
| `✚` zielony | OPATRZONY — stabilny, ale dalej leży |
| `◓` zielony | JE — ręce zajęte |
| `✚` zielony (stojący) | BANDAŻUJE / PODAJE MEDKIT — ręce zajęte |

### 8. Menu przy człowieku ma tyle wierszy, ile jest wyjść

Sześć wierszy, z których trzy zawsze były martwe, zeszło do dwóch żywych:
powalony dostaje `TREAT` i `MEDKIT`, trup `EJECT` i `BAG`. Trup nie dostaje już
propozycji leczenia.

**Wrogie kadłuby dostają 2–4 apteczki** (`Utils.randInt`), więc dawki mają skąd
brać się w grze, a nie tylko ze sklepu.

### 9. Czego tu NIE ma

- **poziomy medbayu nie bramkują chorób** — to update80 razem z tlenem; gracz
  potwierdził, że `maxLevel` zostaje **8** (wyższy poziom to bufor na rozbity
  pips: `workingLevels = level − damagedLevels`), a poziomy 4–8 zostają puste
- **automatyczne jedzenie przy głodzie** — update79; dziś FEED jest ręczny
- **kot na rozkaz** — update81

### 10. Testy

Sekcja **256** (`A bandage, a medkit and a ward are three different things`)
plus dopisane asercje w 254, 225, 236b. **19 rewertów `#78`, wszystkie złapane.**

**Pełny przebieg łamiący znalazł jednak dziewięć rzeczy i to jest ważniejsze
od samych poprawek — ŻADNA z nich nie była czerwona.**

**Cztery testy przestały cokolwiek mierzyć**, wszystkie z tego samego powodu:
mierzyły PUNKTY ŻYCIA, a opatrunek przestał ich dotykać.

| test | co mierzył | co mierzy teraz |
|---|---|---|
| „nikt nie bandażuje abordażysty" | HP wroga | `_bandaged` + zużyta dawka |
| „nikt nie klęka w trakcie bijatyki" | HP rannego | `_bandaged` + dawka + zajętość |
| „medbay nie leczy przez bijatykę" | nic (pętla nie pytała `medbayPatients`) | lista pacjentów i HP po oczyszczeniu pokoju |
| „głodny kot nie otwiera zieleniny" | pudełko po `petTick`+`hungerTick` | **+ `_busyTick`** — bez niego posiłek nigdy się nie kończył |
| „sanitariusz wraca na posterunek" | `carried \|\| delivered` — samo podniesienie | osobny test na sam `_errandRoomId`, bez podróży |

**Pięć zardzewiałych kotwic** — rewerty celujące w linie, które ta paczka
przepisała albo skasowała. Cztery przecelowane, jedna **skasowana jako
duplikat** (`#66 the menu offers FEED to a corpse` celował w tę samą linię co
nowy rewert `#78`; dwa rewerty jednej linii to dwa rejestry).

Cztery pułapki dołożone do listy:

- `setPowerAt(maxPower)` w teście **nie zapala modułu** — budżet reaktora jest
  przeliczany co klatkę. Stąd nowy pomocnik `powerModule(ship, type, n)`
- asercja „jest zajęty" **w klatce rozkazu** jest zawsze prawdziwa i niczego nie
  mierzy — zegar trzeba czytać w POŁOWIE czynności
- **pętla testowa musi kręcić `_busyTick`**, inaczej żadna czynność się nie
  kończy i skutek nigdy nie następuje — a test, który sprawdza, że skutku NIE
  MA, przechodzi wtedy zawsze
- **powalony wróg NIE czyni pokoju spornym** (`occupantsOf` chce `alive`), więc
  filtr strony w pętli bandażowania jest jedyną rzeczą, która go chroni
- `sh.cargo.add('medical_supplies')` nie istnieje — przedmiot nazywa się
  `medkit`. Zrzut ekranu pokazał `doses: 0` i to był mój błąd w scenie, nie w grze

## 5-0aa. ZMIANY update77 (KARBONIT)

**Bryg został karbonitem.** Ten sam sprzęt, inna robota (spec gracza, 22.09):
**nie zamyka ludzi, tylko zatrzymuje im czas.** Wchodzi każdy — skazaniec, którego
wieziesz po nagrodę, albo twój własny strzelec z ukąszeniem pająka, dla którego
nie ma lekarstwa na pokładzie. Płacisz **płytą, jednostką prądu i jego rękami**.

### 1. 1 poziom = 1 miejsce = 1 prąd

Pojemność czytała sam `workingLevels`, więc prąd był zero-jedynkowy: trzy cele
zostawały trzema celami aż do zgaśnięcia świateł. **Teraz ucięcie jednostki
zabiera płytę przy stojącym module** — i to jest różnica między pokrętłem
a wyłącznikiem.

**Wychodzi ten, który wszedł OSTATNI.** Zasada jest przewidywalna *przed*
pociągnięciem pipsa, nie po. Numer płyty jest **wyliczany z ludzi już w środku**,
nie trzymany w liczniku na statku — licznik trzeba by zapisywać, wczytywać
i trzymać w zgodzie z załogą, która i tak zna odpowiedź.

### 2. Zegar wirusa STAJE — i to jest stop, nie reset

Wychodzi **dokładnie tak chory, jak wszedł**. Karbonit kupuje przejazd do
placówki badawczej; **nie leczy nikogo**. To jest cała mechanika w jednym zdaniu
i test sprawdza obie połowy: że nie drgnie przez dwadzieścia sekund pod lodem
i że **rusza dalej z tego samego miejsca** po wyjęciu.

### 3. Człowiek w płycie nie jest w żadnym pokoju

**Jeden strażnik** w pętli załogi, i to on sprawia, że karbonit cokolwiek znaczy:
zamrożony **nie chodzi, nie walczy, nie oddycha, nie pali się, nie je i nie może
zostać wybrany jako człowiek przy konsoli** — bo wszystko, co szuka ludzi, szuka
ich PRZEZ POKÓJ, a ta pętla jest jedyną rzeczą, która go do pokoju wstawia.

Alternatywą było `if (c.frozen) return;` w tuzinie pętli i trzynasta pętla
dopisana za miesiąc bez niego.

### 4. Skazaniec ma pierwszeństwo do płyty

Rozmrożenie da się cofnąć, ucieczki nie. Więc gdy płyt ubywa, wychodzą **twoi**,
a skazańcy zostają.

**I skazaniec bez płyty zaczyna majstrować przy zamku, mimo że moduł świeci.**
Ten warunek zadawał jedno pytanie tak/nie — czy moduł jest wyłączony — więc trzech
skazańców w module ściętym z trzech jednostek do jednej **siedziało spokojnie**.

### 5. `brig` to alias, w jednej tabeli

Czytany w **każdych drzwiach**, przez które typ modułu przychodzi z zewnątrz.
To jest zmiana nazwy, nie nowy moduł: stary zapis wczytuje się jako karbonit
**z poziomem, do którego był ulepszony**. Plik ikony też pojechał za nazwą:
`art/icon_brig.png` → `art/icon_carbonite.png`.

### 6. Zrzut ekranu złapał to, czego nie złapie żadna asercja

Pasek znaczników mówił „zamrożony", a **POKŁAD nie mówił nic** — gracz patrzył na
statek i widział trzech ludzi w pokoju, z których dwóch nie mógł nic zrobić.
Teraz są **rysowani w płytach**: przyciemnieni za lodem, szron w poprzek, imię nad
płytą i nic więcej — bo nic się z nimi nie dzieje i nie ma czego więcej napisać.

Geometria płyty jest wzięta z rysowania stojącego człowieka, nie wypisana drugi
raz — pierwsza wersja miała własne liczby i **płyta pływała nad głową**, co też
pokazał dopiero zrzut.

### 7. Co się dzieje w doku

**Nikt nie jest bankowany zamrożony.** Płyta chodzi na prądzie statku, a statek
jest rozładowywany; koszary nie mają karbonitu, więc człowiek zapisany w połowie
zamrożenia wróciłby na kadłub, w którym nie ma dla niego płyty. Jego zegar rusza
w doku — to jest ta sama umowa: **karbonit kupuje przejazd, nie leczenie**.

### Testy

Nowa sekcja **255**. Razem **4518 asercji + 79 kroków rysowania + 89
w przeglądarce**. `tests/break_check.js`: **475 rewersów** (15 nowych,
**12 przecelowanych**).

Dwanaście — bo zmiana nazwy przechodzi przez cały plik i **każda kotwica
cytująca linijkę z `brig` przestała istnieć**. To jest przewidywalny koszt
renejmu i dlatego robi się go raz, a nie po kawałku. Każdy z dwunastu
sprawdzony osobno: pilnują dokładnie tego, co pilnowały.

**Jeden rewers okazał się faktem o kodzie.** `_slabRefusal` pytało
`pod.isDisabled()` — a od chwili, gdy pojemność liczy prąd, **ciemny moduł nie
ma ani jednej płyty**, więc ten warunek nie mógł już nigdy być powodem i gracz
dostawał „every slab is taken" o module, w którym nie ma nikogo. Skasowany;
pyta teraz o pojemność i mówi prawdę o prądzie. Przy okazji trzy identyczne
linijki, które `cellRefusal` i `freezeRefusal` miały u siebie, zjechały do
jednego `_slabRefusal` — bo skazaniec i załogant wydają **tę samą** pojemność.

**Pięć rewersów przeciekło przy pierwszym przebiegu i wszystkie z jednego
powodu:** asercje czytały pola **zaraz po wywołaniu**, zamiast przepuścić statek
przez klatkę — a strażniki mieszkają właśnie w klatce. Test „zamrożony nie jest
w pokoju" przechodził, bo nigdy nie uruchomił pętli, która ludzi do pokojów
wstawia. Teraz jadą przez `ship.update`.

## 5-0ab. ZMIANY update76 (PAUZA I PASEK ZNACZNIKÓW)

### 1. Pauza zatrzymuje świat, nie gracza

**SPACJA, nie P** (decyzja gracza). P miało zresztą drugi problem: to klawisz,
którego nikt nie znajduje.

Spacja jest **klawiszem pauzy wszędzie, gdzie da się pauzować, i nie znaczy nic
innego nigdzie**. Dwa miejsca, w których znaczyła „lecimy dalej" — wyjście
z wygranej walki i zamknięcie ekranu podsumowania — czytają teraz **ENTER**,
a oba i tak miały przycisk i klik do tego samego. To jest wprost lekcja z TAB-a
z update74: jeden klawisz robiący dwie rzeczy zależnie od tego, który ekran jest
na wierzchu, **wraca jako zgłoszenie z gry**.

**A druga połowa to `_update(0)` zamiast pomijania update'u.** Każdy zegar w tej
grze jedzie z `dt`, więc **tik zerowy nie symuluje dokładnie niczego**, a kliki,
zaznaczanie, rozkazy i prąd idą tą samą drogą co zawsze. Pomijanie update'u
zamrażało też WEJŚCIE — czyli pauza była zrzutem ekranu, a nie chwilą do
namysłu. A chwila do namysłu jest tym, po co w grze czasu rzeczywistego jest
pauza.

**Nie na wraku.** Zegar plądrowania to presja, którą gracz ma czuć; pauza tam to
byłby po prostu dłuższy wrak. `_canPause()` mówi: walka i mapa.

**Kurtyna zdjęta.** Stary rysunek zamalowywał cały ekran na 70 % i pisał PAUSED
na środku 48 pikselami — co jest właściwym rysunkiem dla pauzy, w której NIE DA
SIĘ działać, i dokładnie złym dla takiej, w której działać TRZEBA. **Nie da się
wydać rozkazu statkowi, którego nie widać.** Został włos ramki wokół planszy
i jedna pigułka w prawym dolnym rogu.

### 2. Pasek znaczników — trzy zgłoszenia, jedna odpowiedź

**PO JEDNYM NA RAZ.** Rysowanie pytało `c.virus ? … : c.infected ? … : null`,
więc człowiek niosący **oba** pokazywał tylko wirusa, a zaraza była niewidoczna,
dopóki nie wyleczyło się go z gorszej rzeczy. Drabinka `?:` to dobry sposób na
wybór jednego koloru i fatalny na **zdanie raportu**.

**PRZY NAZWISKU.** Znaczniki siedziały w wierszu 100 px, który już niesie
portret, imię, pasek HP i gwiazdkę — było miejsce na dokładnie jeden i nigdy na
drugi. Gracz poprosił „z boku": pasek ma teraz **własną kolumnę w rynnie między
wierszem a panelem załoganta**, ułożoną **2 × 2**.

**I W KTÓRYM MODULE PRACUJE.** Gra płaci premię ze zdolności **JEDNEMU**
człowiekowi na moduł od update43 — temu przy konsoli, slot 0 — i **nigdy tego
nigdzie nie narysowała**. Dwóch strzelców w wieży wygląda dla gracza identycznie,
a robi coś tylko jeden. Znacznik czyta `consoleOperator`, czyli **to samo
wywołanie, które wypłaca premię**, więc obrazek nie może mówić czegoś innego niż
matematyka.

`crewMarks(c, ship)` jest **funkcją, nie rysowaniem** — listę da się zapytać
i sprawdzić, i tylko dlatego „oba schorzenia widać naraz" w ogóle da się
przetestować.

Pulsowanie dalej znaczy OSTRZEŻENIE i nic więcej: jest na dwóch rzeczach, które
się pogarszają, gdy je zignorować (choroba i człowiek, który przestał jeść),
i wyłączone na wszystkim, co jest po prostu prawdą.

### 3. Zrzut ekranu zarobił na siebie dwa razy

* **Panel załoganta otwierał się prosto na dwóch ostatnich znacznikach.**
  Otwiera się, gdy ktoś jest zaznaczony, czyli prawie zawsze. Pasek jest teraz
  **2 × 2 w rynnie**, a krawędź panelu jest **opublikowana** (`Renderer.crewPanelX()`)
  i czytana przez `ui.js` zamiast wypisana po raz drugi — bo dwie ręcznie
  wpisane kopie jednej krawędzi to jest właśnie to, przez co panel na tym pasku
  usiadł.
* **Pigułka pauzy była dwoma wyśrodkowanymi napisami** przez całą dolną krawędź:
  wjeżdżały w siebie („PAUSEDorders still work") i siadały na przycisku AUTO
  panelu broni — kontrolce, której gracz używa **w trakcie pauzy**. Jeden napis,
  prawy dolny róg, który jako jedyny na tym ekranie jest pusty.

### 4. Bryg nie miał glifu

Rysował `?` — na pasku prądu, na miniaturkach i teraz na pasku znaczników.
**Moduł, który nie umie powiedzieć, czym jest, jest gorszy niż nienarysowany.**
Asercja jest ogólna: **każdy typ z `SYSTEM_DEFS` ma własny glif**, więc następny
nowy moduł nie wejdzie z pustką.

### 5. Test, który przestał mierzyć cokolwiek — złapany w trakcie pisania

Asercja „pauza nie zamalowuje planszy" przechwytywała `fillRect`. Kiedy
przerysowałem pigułkę na `roundRect`, **asercja została, rysowanie wyszło spod
niej i przechodziła, nie mierząc niczego**. Przechwytuje teraz oba wywołania.
Ten sam kształt błędu co dwa razy w update75 — test zielony z niewłaściwego
powodu — tylko tym razem zrobiony przeze mnie w tej samej godzinie.

### Testy

Nowe sekcje **253** (pauza) i **254** (pasek znaczników).
Razem **4468 asercji + 79 kroków rysowania + 89 w przeglądarce**.
`tests/break_check.js`: **460 rewersów** (16 nowych, 1 przecelowany — rewers
odczytu zegara wirusa z update74 celował w `markX`, które znikło razem ze starym
rysowaniem znacznika).

## 5-0ac. ZMIANY update75 (BROŃ JAKO SKRZYNIA)

**Skasowany `weaponCargo`.** Goła lista kluczy broni, która nic nie ważyła,
nie zajmowała ani jednej kratki i nie była rysowana w żadnym miejscu, w które
gracz mógłby wskazać palcem — **drugi magazyn stojący obok siatkowej ładowni**,
która i tak trzymała zapakowane działa jako zwykłe skrzynie. Trzydzieści
odwołań w pięciu plikach.

### 1. Dlaczego to musiało pójść

Dwa rejestry na jedną rzecz zawsze się rozjeżdżają, a ta para rozjechała się
**publicznie**:

* **Zgłoszenie gracza:** załoga się poddaje, oddaje broń — i gracz nie dostaje
  nic. Broń istniała. Leżała na wieszaku, którego nikt nie rysuje.
* **Stacja musiała się z tym mocować:** `ship.uninstallWeapon` wpychał broń na
  wieszak, stacja ją stamtąd **wyjmowała**, pakowała do skrzyni, a przy braku
  miejsca **wkładała z powrotem**. Trzy linijki uzgadniania dwóch rejestrów na
  jeden ruch.
* **Sklep rysował tę samą broń dwa razy** — raz na wieszaku, raz w ładowni — z
  przyciskami BOX INTO HOLD i UNBOX ONTO THE RACK do przerzucania jej tam i
  z powrotem. Gracz musiał wiedzieć, na którą z dwóch list patrzy.

**Jest teraz dokładnie jedna odpowiedź na pytanie „gdzie jest to działo":
PRZYKRĘCONE albo W SKRZYNI W ŁADOWNI.**

### 2. Co weszło na to miejsce

| co | zasada |
|---|---|
| `Ship.uninstallWeapon(slot, dest)` | **jedyny** sposób zdjęcia działa z mounta. Trzyma regułę, którą obaj wołający mieli skopiowaną u siebie: **jeśli skrzynia nie ma gdzie wylądować, NIC się nie rusza**. `dest` to ładownia w locie, półka zbrojowni w hangarze |
| `Ship.scrapWeapon(slot)` | **zniszczenie, zapisane wprost.** Budowa wrogiego kadłuba wołała `uninstallWeapon` i liczyła na to, że broń wyląduje na liście, której u wroga nikt nie czyta — niszczenie efektem ubocznym, w funkcji, której cała obietnica brzmi „broń zostaje zachowana" |
| `Ship.boxedGuns()` | **jedna** definicja „zapasowego działa na pokładzie". Ten filtr był wypisany ręcznie w czterech miejscach |

### 3. Sklep wydaje towar, zanim weźmie pieniądze

`buyWeapon` **najpierw pobierał CC, a dopiero potem szukał miejsca** — co było
nieszkodliwe wyłącznie dlatego, że wieszak zawsze miał miejsce. Teraz ładownia
może być pełna, więc **transakcja, której nie da się zrealizować, w ogóle się
nie odbywa**: gracz zostaje przy swoich pieniądzach, a działo na półce.

Karta w sklepie mówi też, **ile to kosztuje w miejscu**, a nie tylko w CC:
*„Arrives boxed: 3x3 cells in the hold"*.

### 4. Skasowany wyjątek w doku

`Base.returnFromRun` miał osobną regułę **napisaną wyłącznie dla broni** —
przepisywał `weaponCargo` na półkę zbrojowni. Bo broń była jedyną rzeczą na
pokładzie, która nie mieszkała w ładowni. **Teraz mieszka**, a ładownia i tak
jest sortowana na półkę przy dokowaniu. Reguła ogólna robi to, co robił wyjątek
— więc wyjątek poszedł, zamiast dorobić sobie drugi.

`report.gunsStored` poszedł razem z nim: liczony tutaj i czytany **nigdzie**.
Liczba, na którą nikt nie patrzy, to nie raport, tylko miejsce, w którym dwie
prawdy mogą się po cichu rozjechać.

### 5. Heavy Laser dostaje dużą skrzynię (decyzja gracza)

Próg `75` → **`65`** w `cargoCrateForWeapon`. **Jedna liczba**, nie pole
rozmiaru przy każdej broni — drugi rejestr obok ceny kończyłby się tak samo jak
wszystkie poprzednie.

| skrzynia | przed | po |
|---|---|---|
| mała 2×2 | Laser Mk I, Ion Cannon I | bez zmian |
| średnia 3×2 | Artemis 55, Flak 60, Burst II 65, **Heavy Laser 70** | Artemis, Flak, Burst II |
| duża 3×3 | Hull Cannon 80, Dual Beam 85 | **+ Heavy Laser** |

Podział **2/3/3** zamiast 2/4/2, i „Heavy" znowu znaczy heavy.

### 6. VENT → EJECT

Od update73 **wentylacja to kanał pod sufitem** — biegnie nim ogień, mieszkają
w nim szczury. Rozkaz wyrzucenia ciała przez śluzę nazywał się tym samym
słowem. Dwie różne rzeczy, jedno słowo, na jednym ekranie.

**EJECT, nie JETTISON**, bo wiersz przycisku ma 44 px czcionki 9 px — dłuższe
słowo wyjeżdża poza własny przycisk. (Zmierzone, nie zgadnięte.)

**Śluza zostaje niebezpieczna** (decyzja gracza 22.09): niosący stoi w próżni
kilka sekund, skafander trzyma 8 — pogrzeb może kosztować niosącego. To jest
cena decyzji, nie bug. `Ship.VENT_KARMA` → `Ship.EJECT_KARMA`. `bodyOrder` nie
jest zapisywany do save'a, więc migracja nie była potrzebna — sprawdzone, nie
założone.

### 7. Kafel podłogi przycinany, nie ściskany

Pokój nigdy nie ma całkowitej wielokrotności 48 px, więc ostatni kafel w rzędzie
jest kawałkiem. Obaj rysujący **zmniejszali prostokąt DOCELOWY i zostawiali
źródłowy w całości** — czyli wciskali cały obrazek w wąski pasek. Przy
generowanym szumie nie było tego widać. Przy narysowanej płycie pokładowej
**każdy pokój w grze miałby ściśnięty rząd przy ścianie**.

Napisane raz, jako `Assets.tileRect`, w module, który jest właścicielem
sprite'ów — żeby nie dało się naprawić jednej kopii i zapomnieć o drugiej.

Strzeżony jest `cell`, a `w`/`h` **nie**, i to jest celowe: zerowa szerokość po
prostu nie wykona pętli, ale **zerowy kafel nigdy nie przesunie `tx` i zawiesi
klatkę** — a zawieszenie to jedyna awaria, której przebieg łamiący nie umie
zgłosić.

### 8. I ten sam błąd, popełniony przeze mnie w tym pliku

Tabela „liczb do wyważenia na żywo" w §6.3 miała **dwa wiersze na próg skrzyń**
— stary `≤50 / ≤75` i dopisany przeze mnie `≤50 / ≤65`, oba wskazujące na tę
samą funkcję. Dwie kopie jednej liczby w tabeli, której cały sens polega na
tym, że każda liczba mieszka w jednym miejscu. Skasowane do jednego wiersza.

Osobno: **§U14 niosła drugą tabelę kolejności prac**, rozjechaną z tą z §6
o dwie paczki (u niej 74 = GRAFIKA, u tamtej 74 = drobne zgłoszenia).
Skasowana — jedna kolejność prac żyje w §6.

### 9. Zrzut ekranu złapał jeszcze jedną rzecz

Przycisk przy stanowisku dalej mówił **UNINSTALL → CARGO**. „CARGO" to była
nazwa, którą wieszak nadał sam sobie. Teraz **UNINSTALL → HOLD**.

### Testy

Nowe sekcje **250** (nie ma trzeciego miejsca na broń), **251** (rozbieranie
wrogiego kadłuba to nie to samo co odkręcenie działa), **252** (kafel przycinany,
nie ściskany). Razem **4413 asercji + 79 kroków rysowania + 89 w przeglądarce**.
`tests/break_check.js`: **445 rewersów** (13 nowych, 1 przecelowany).

**Dwa rewersy przeciekły przy pierwszym przebiegu i oba były testem, który
przechodził z niewłaściwego powodu:**

* „stacja montuje skrzynię z cudzej ładowni" — celowałem w **zajętą** wnękę,
  więc odmowa przychodziła z „ten mount jest zajęty", a nie z tego, czego
  pilnowałem. Teraz wolna wnęka **i sprawdzenie treści komunikatu**.
* „budowa wroga chowa startowe działo zamiast je zniszczyć" — prosiłem o walkę
  `'hard'`, a ta podmiana jest **bramkowana plakatem gonczym na węźle**, nie
  poziomem trudności. Test **nigdy nie wchodził w kod, którego pilnował**, i
  przechodził. Teraz prawdziwy plakat na prawdziwym węźle.

## 5-0ad. ZMIANY update74 (ZGŁOSZENIA Z ŻYWEJ GRY)

Sześć rzeczy zgłoszonych po testach 22.09, wszystkie drobne, **cztery z nich
okazały się kolejnymi kopiami jednej liczby**.

### 1. Jedenaście ikon od gracza, i pięć modułów przestało nosić cudzą

Gracz przysłał arkusz jedenastu ikon 64 × 64. Pokrywały się **co do sztuki**
z jedenastoma modułami w grze — a pięć z nich nosiło do tej pory cudzą:

```
reactor      icon_engines  →  icon_reactor
cloaking     icon_engines  →  icon_cloaking
autorepair   icon_medbay   →  icon_autorepair
brig         icon_medbay   →  icon_brig
artillery    icon_weapons  →  icon_artillery
```

Reaktor i cloak pokazywały SILNIKI, warsztat i bryg ten sam KRZYŻ medyka,
artyleria zwykłe działo. Pięć przedziałów kłamało o tym, czym są, na ekranie,
którego cała robota polega na pokazaniu, z czego statek jest zbudowany.
Dług z §6.2, wiszący od update63, spłacony.

Każdy z piątki dostał **generowaną podłogę** — gra musi ruszyć bez plików —
a pliki gracza nadpisują je przez manifest z update73a.

**Dwie asercje to trzymają.** Żaden moduł nie dzieli ikony z innym; i **każda
nazwa ikony naprawdę istnieje**, bo literówka w nazwie nie robi błędu, tylko
**pustkę** — moduł wygląda na pusty zamiast na zły, a to trudniej zauważyć.

**Wycofana rada.** Przy 26 px doradziłem graczowi wyrzucenie dekoracyjnego
pierścienia — na płaskim pasku zjadał jedną trzecią powierzchni. **Na pokładzie
działa odwrotnie:** oddziela ikonę od siatki podłogi i bez niego symbol by się
w niej rozpłynął. Wniosek wyciągnięty z porównania dwóch pasków zamiast
z ekranu gry — dokładnie ten błąd, przed którym ta sekcja ostrzega od update72a.

### 2. TAB znaczył dwie różne rzeczy

W walce chodził po załodze; **na mapie był drugim klawiszem M** i przełączał
widok. Ten sam palec robił co innego zależnie od tego, który ekran był na
wierzchu — i tak wrócił jako zgłoszenie z gry.

TAB jest teraz **klawiszem załogi wszędzie**, M i przycisk są widokiem. Cykl
wyciągnięty do `_cycleCrew()`, nie skopiowany — dwie kopie reguły wyboru
rozjechałyby się przy pierwszym nowym rodzaju załoganta.

Test sprawdza **obie strony**: TAB chodzi po załodze i NIE rusza widoku, M
rusza widok i NIE dotyka zaznaczenia. Każda połowa osobno to pół testu.

### 3. Nagrobek dla kogoś, kogo ciała nie ma

Wzgórze stawiało krzyż dla **każdego** wpisu na cmentarzu, także dla tych,
których nikt nie przywiózł — więc ten sam człowiek miał nagrobek TU i linijkę
w NOT RECOVERED pół metra obok. **Gra zaprzeczała sobie na jednym ekranie.**

Krzyż jest teraz tylko dla `buried`, czyli dla ciała, które naprawdę zjechało
ze statku w doku. Dwa panele się uzupełniają, każde nazwisko pada raz.

**Nagłówek był drugą połową tego samego błędu** — liczył wszystkich zmarłych
i pisał *„N crew never came home"*, rysując przy tym kamień dla każdego. To ta
sama sprzeczność, tylko napisana słowami.

### 4. Zegar wirusa zszedł z ekranu

update69 zamienił gołe „5" (liczbę WALK, bez niczego na ekranie, co by to
mówiło) na odliczanie M:SS. update74 zabiera odczyt w ogóle — decyzja gracza:
*„czas wirusa niech nie będzie wyświetlany, gracz nie powinien wiedzieć, kiedy
dokładnie wirus się aktywuje"*.

Ma rację, i z tego samego powodu, dla którego warto animować mur karmy:
**liczba zamienia lęk w arytmetykę.** 4:12 mówi dokładnie, jak długo można
odkładać decyzję. Migający znak bez liczby każe zdecydować teraz.

`virusT` istnieje i statek dalej go tyka — zniknął **odczyt**.

Test nie sprawdza „nie ma tej jednej liczby", tylko że **człowiek z czterema
sekundami wygląda identycznie jak ten z dwiema minutami** — inaczej przeszedłby
odczyt przeformatowany zamiast usuniętego.

### 5. Zegar plądrowania: 50 s → 30 s, i pięć kopii → jedna

*„za dużo mamy teraz czasu do namysłu"* — w pięćdziesiąt sekund ładownię da się
rozwiązać jak planszę Tetrisa, na spokojnie, co jest odwrotnością tego, po co
jest zegar na wraku.

Pięćdziesiątka była wypisana w **pięciu** miejscach w `game.js`: trzy `?? 50`,
inicjalizator `_wreckSecs` i podłoga `Math.max(20, …)`. Teraz
`Ship.LOOT_SECONDS` = **30** i `Ship.LOOT_SECONDS_MIN` = **15**, w jednym
miejscu. Obie to pokrętła — spodziewam się, że ruszymy je po testach.

Test pyta **ekran**, nie stałą: dokuje do wraku tą samą drogą co gracz i czyta
`LootScreen.secondsLeft()`. Napisany jako „mniej niż pięćdziesiąt", a nie
„równe 30" — strojenie ma nie psuć testu, ale **cofnięcie zmiany ma**.

### 6. OBJ nachodził na SHOW MAP i CARGO — i jak to naprawiłem dwa razy

Linia celów siedzi na y 40 wysokości 17, a SHOW MAP na y 42 — rysowany prosto
przez nią.

Linia dostała **opublikowany prostokąt** (`Renderer.runGoalsBox()`), żeby
przyciski były stawiane WZGLĘDEM niej, a nie obok niej na oko, i żeby dało się
to **sprawdzić testem** zamiast przesuwać współrzędne aż przestaną się mijać.

**Pierwsza poprawka była zła i pokazał to zrzut ekranu.** Zjechałem przyciskami
w dół — i CARGO wjechał w zielony baner „CHOOSE YOUR STARTING LANE", czyli
w pierwszą rzecz, jaką gracz widzi w przebiegu. Pas między zasobami a panelem
mapy ma 40..115 i **nie mieści dwóch rzędów przycisków i banera**.

Mieści **jeden rząd dwóch**. Przyciski stoją obok siebie: 28 px pionu z
powrotem, baner zostaje na miejscu, para dalej czyta się jak para.

Do tego asercja, która kiedyś kogoś uratuje: **przyciski stoją w tym samym
miejscu niezależnie od tego, czy kontrakt ma cele.** Stawianie ich pod linią
tylko wtedy, gdy linia coś niesie, przeszłoby test nachodzenia i dało graczowi
przycisk, który wędruje między kontraktami. (Napisałem to najpierw źle —
komentarz mówił „stała pozycja", a kod czytał `runGoalsRect()`, czyli „czy jest
coś na linii dzisiaj". Stąd rozdzielenie na `runGoalsBox()` i `runGoalsRect()`.)

### 7. Rewers, którego nic nie łapie, bywa faktem o KODZIE

Rewers „zegar plądrowania skopiowany zamiast czytany" celował w
`let _wreckSecs = …`. Nie złapał go żaden test — i słusznie:
**`_startWreckBoarding` nadpisuje tę zmienną, zanim cokolwiek ją przeczyta.**
Inicjalizator jest martwy.

Przecelowany na linię, która faktycznie działa. Ale wniosek zostaje: *nie
złapane* nie zawsze znaczy „brakuje testu" — czasem znaczy „ta linia nic nie
robi", i to jest wtedy do naprawienia w kodzie, nie w teście.

### 8. Gałąź, w którą już nie da się wejść — i test zielony z tchórzostwa

Punkt 3 (krzyż tylko dla `buried`) zabił **drugą połowę** karty epitafium.
Linijka była napisana jako `g.buried ? 'brought home and buried' : 'no body
recovered'` — słusznie, dopóki wzgórze stawiało kamień każdemu. Od chwili
wejścia filtra **na wzgórzu nie ma nikogo niepochowanego**, więc `else` nie
da się wykonać. Warunek usunięty, została jedna linijka.

To ten sam wniosek co §7, z drugiej strony: *kod nieosiągalny z pewnym
komentarzem nad sobą jest gorszy niż żaden kod* — bo czytający wierzy, że gra
umie dwie rzeczy, a umie jedną.

**A potem rewers tej linijki nie został złapany dwa razy z rzędu.** Obie
asercje (sekcja 85 i sekcja pochówku w doku) szukały `/brought home and
buried/` w **całym** przechwyconym tekście ekranu — a nagłówek panelu pisze
*„N brought home and buried. Hover a marker…"* przy KAŻDYM rysowaniu. Regexp
był zielony niezależnie od tego, czy karta rysowała swoją linijkę.

Obie porównują teraz **dokładnie**: linijka karty to to zdanie i nic więcej.
Rewers sprawdzony — sekcja robi się czerwona. Klasyczny „test przechodzi
z niewłaściwego powodu" z pkt. 3 kontraktu, złapany dopiero przez rewers.

### Testy

Nowa sekcja **249**, przepisane **88**, **96**, **185** i sekcja cmentarza.
Razem **4369 asercji + 79 kroków rysowania + 89 w przeglądarce**.
`tests/break_check.js`: **432 rewersy** (15 nowych, 1 skasowany, 1 przecelowany).

Pełny przebieg łamiący zgłosił dwie **kotwice, których już nie ma** — obie
dlatego, że update74 ruszył kod pod nimi:

* *„#69 the roster prints a bare number again"* — **skasowany**. Pilnował, żeby
  odczyt M:SS nie zsunął się z powrotem do gołego „5", a pkt 4 zabrał odczyt
  z ekranu w całości. Dziś ważne jest, żeby liczba NIE wróciła, i tego pilnuje
  rewers *„#74 the roster tells the player exactly when the virus fires"*.
* *„#71 the objective line draws on a run with no goals"* — **przecelowany**;
  `const y = 40, h = 17` przeniosło się do `RUN_GOALS_BOX`. Sprawdzony: łapie.

### Nowe pliki w paczce

`art/icon_*.png` — **jedenaście ikon gracza**. Plus `art/manifest.json` z
wypełnioną listą.

## 5-0ae. ZMIANY update73a (KANAŁ NA DWA KAFLE I RYSOWANA GRAFIKA)

Dwie rzeczy, obie fundamentowe. Zero nowej mechaniki.

### 1. Kanał ma dwa kafle, bo TAK WYSZŁO Z POMIARU

update73 wybrał jeden kafel **na oko** i oko się myliło. Sprite'y, które mają
tam zamieszkać, zostały wyrenderowane w prawdziwej przeglądarce na rozmiarze,
w jakim gra je rysuje (`anim.draw(…, 32, 32)`), i policzone piksel po pikselu
w każdej klatce każdego trybu:

| | chód | stój | walka | w kanale 10 px |
|---|---|---|---|---|
| szczur | 10 | 9 | 10 | mieścił się co do piksela |
| pająk | 11 | 11 | 13 | **nie mieścił nawet stojąc** |
| kot | 13 | **16** | 14 | nie mieścił w żadnym trybie |

Kot jest najwyższy, **bo siedzi na zadzie** — świadoma decyzja z update45, żeby
jego sylwetki nie dało się pomylić ze szczurem (*„one of them you want aboard
and the other you do not"*). Ta decyzja nie mieści się w dziesięciu pikselach.

```
MODULE_H  60 → 70   (7 kafli)
VENT_H    10 → 20   (2 kafle)
wnętrze   50 → 50   ← BEZ ZMIAN
```

**Moduł urósł, pokład nie**, więc każda liczba, której dotyka załoga — linia
chodzenia, drzwi, stanowiska — jest dokładnie tam, gdzie była. Kadłuby są
wyższe o 10 px na pokład: Apophis 350 px zamiast 300 (i 428 sprzed update73),
czyli dalej niższa, niż była.

**Ten pomiar jest teraz TESTEM.** `browser_test.js` sesja 6 renderuje każdą
klatkę każdego zwierzęcia i liczy nieprzezroczyste piksele — bo w harnessie
Node canvas nic nie rysuje, więc „czy kot jest wyższy od kanału" to pytanie,
na które poza przeglądarką nie ma odpowiedzi. Przerysuj kota, a test padnie
tego dnia, a nie w dniu, w którym ktoś zauważy, że wystaje. Jest też asercja
w drugą stronę: kanał ma być **najmniejszą całkowitą liczbą kafli, która
działa** — trzy kafle też by przeszły i zjadłyby przedział.

### 2. Loader rysowanej grafiki — plik NADPISUJE generator, nigdy go nie zastępuje

Cała grafika w tej grze jest **rysowana kodem** w `js/assets.js` i to zostaje
**podłogą, nie zaślepką**: gra musi startować przy zerze plików graficznych, bo
dziś ma ich zero, a w dniu, w którym jeden się nie wczyta, dalej ma wstać.

Dlatego plik **nadpisuje** sprite o tej samej nazwie, a wszystko bez pliku
zostaje przy rysunku z kodu. **Grafika może przychodzić po jednej ikonie**,
zamiast wszystka naraz.

**Manifest jest powodem, dla którego to jest ciche.** Odpytywanie o każdą nazwę
to czterdzieści żądań i czterdzieści 404 w konsoli działającej gry. Zamiast
tego jest **jedno** żądanie — `art/manifest.json` — i jeśli go nie ma, nic
więcej nie jest pytane.

```
art/manifest.json    { "_readme": […], "sprites": [] }
art/icon_medbay.png
```

Manifest **sam się tłumaczy**: JSON nie ma komentarzy, więc przyjmowane są dwa
kształty — goła tablica albo obiekt z `sprites`, który może nieść notkę. W
paczce jedzie z pustą listą, czyli gra wygląda dokładnie tak jak dziś.

**Nic tu nie może zawiesić startu.** Każde czekanie ma timeout, każda porażka
jest cicha z założenia — brakujący plik to przypadek normalny, nie błąd.
`Assets.source(name)` mówi, czy gracz patrzy na `'file'` czy na `'generated'`.

### 3. Co wyłapał przebieg łamiący — i jedna rzecz gorsza od buga

Pierwszy filtrowany przebieg złapał **5 z 7**. Drugi przeciek był zwykły
(test wołał loader bezpośrednio, więc nie widział, że `init()` w ogóle go nie
podłącza — poprawione przejściem frontowymi drzwiami). Pierwszy był poważny:

> **Test, który się zawiesza, nie failuje — on ZNIKA.**

Sekcja `async` zwraca obietnicę, a nikt na nią nie czekał. Kiedy rewers wyjął
timeout z loadera, ciało sekcji stanęło w pół, **asercje po tej linii po prostu
się nie wykonały**, a zestaw wypisał swoją sumę i wyszedł **na zielono**.
Po cichu pominięty test jest gorszy od padającego, a przebieg łamiący nie widzi
go w ogóle — szuka porażki, która nigdy nie przychodzi.

Doszła więc funkcja `asyncSection()`: sekcje asynchroniczne **rejestrują się**,
ostatnia sekcja na nie czeka, a każda ma własny zegar. **Zawieszenie jest teraz
FAILem z nazwą.**

### Testy

Nowa sekcja **248**, nowa sesja **6** w przeglądarce, nowy mechanizm
`asyncSection` w harnessie testów. Razem **4314 asercji + 79 kroków rysowania
+ 89 w przeglądarce**. `tests/break_check.js`: **418 rewersów** (7 nowych).

### Nowy plik w paczce

`art/manifest.json` — **musi trafić do repo**, inaczej przy starcie leci 404
(nieszkodliwe, ale brudzi konsolę i wywala asercję „no page errors").

## 5-0af. ZMIANY update73 (KAFELKI, KANAŁ I KADŁUB Z PROFILEM)

Paczka geometryczna. **Żadnej nowej mechaniki** — to fundament pod grafikę (74),
szkodniki w wentylacji (77) i grawitację (81). Po niej gra działa tak samo,
tylko wygląda inaczej i da się ją narysować.

### 1. Siatka istniała od update41 — to jest jej podział

Łatwo o tym zapomnieć, więc na wierzchu: `HULL_GRID` trzyma **jeden rozmiar
modułu na całą grę**, kadłuby są wypisane w `(col, row)`, a piksele są
**wyliczane**. Ta paczka nie buduje siatki, tylko **dzieli istniejący moduł na
kwadraty 10 × 10** i dokłada regułę:

> **Każda długość w `HULL_GRID` jest całkowitą wielokrotnością `TILE`.**

Sekcja 247 to sprawdza. Dzięki temu art kit to garść kwadracików 10 × 10 —
narożnik, krawędź, podłoga, kratka — a nie jeden rysunek na kadłub. Liczba
poprawiona „o piksel pod jeden ekran" wywala zestaw, zamiast po cichu zrobić
jeden kafel w jednym kadłubie w złym rozmiarze.

### 2. Moduł się położył: 80 × 72 → 100 × 60

| stała | było | jest | kafli |
|---|---|---|---|
| `MODULE_W` | 80 | **100** | 10 |
| `MODULE_H` | 72 | **60** | 6 (z kanałem) |
| `VENT_H` | — | **10** | 1 |
| `DECK_GAP` | 8 | **0** | kanał JEST przerwą |
| `DECK_PITCH` | 80 | **60** | 6 |
| `SHAFT_W` | 28 | **30** | 3 |
| `MARGIN` | 14 | **10** | 1 |
| `ENGINE_W` | 48 | **40** | 4 |
| `PROW_W` | 40 | **30** | 3 |

Proporcja **1,67 : 1** zamiast 1,11 : 1 — kwadrat czytał się jak cela, nie jak
przedział. Apophis chudnie z 428 px na 300 i przestaje zajmować cały ekran.

**Zmierzone, nie wybrane.** Kamera nigdy nie zoomuje (`Camera.setZoom` nie jest
wołane znikąd), więc oba kadłuby są rysowane 1:1 w 1280 i to jest twarda ściana.
Najszerszy kadłub gracza i najszerszy wroga mają po 520 px, czyli do podziału
jest 240. Panel rozkazów po lewej kończy się koło x=120 i statek nie może na nim
stanąć — to przybija lewy margines do ~140 i zostawia 100 na przerwę dla
pocisków i prawy brzeg. **70 i 30.**

**Dlaczego nie 120 px:** dwa czterokolumnowe kadłuby dawały 1268 z 1280 —
dwanaście pikseli na strzelanie. Przy 120 Hapi musiałaby zejść z czterech kolumn
na trzy; przy 100 **żaden kadłub nie musi się zmieniać**.

Kafle rufy i dziobu zeszły o kafel każdy. To dekoracja; przedziały są statkiem,
a te 20 px na burtę to 20 px otwartej przestrzeni między statkami.

### 3. Kanał wentylacyjny — górny rząd kafli KAŻDEGO modułu

Nie osobny pas między pokładami. Wersja gracza i lepsza z trzech powodów:

1. **Jest na statku jednopokładowym.** Pas między pokładami by nie był
2. **Nie ma własnej geometrii** — ma współrzędne swojego modułu
3. **Sieć wentylacji to `Room.adjacent`**, który ten silnik ma od zawsze.
   Szczur pójdzie z kanału pokoju A do kanału pokoju B, jeśli A sąsiaduje z B —
   **zero nowego szukania drogi.** To była największa pozycja kosztowa
   przyszłej paczki 77 i właśnie zniknęła

`Room` dostaje `ventY`, `ventH`, `floorTop`, `floorH` — **wyliczane, nigdy
zapisane**. Zapisany `ventY` byłby tą samą liczbą drugi raz.

Kanał jest **rysowany i widoczny**, i to nie jest ozdoba: do kanału wprowadzają
się szkodniki, a zagrożenie, którego gracz nie widzi, to zagrożenie, o którym
nie wie. Przy okazji robi drugą robotę za darmo — `DECK_GAP` to teraz 0, więc
bez tego pasa dwa pokłady stykałyby się włosem i dwupokładowy kadłub czytałby
się jak jedna wysoka krata.

### 4. Kadłub z profilem — Bastet nie jest już prostokątem

Wolna wnęka **PRZENIOSŁA SIĘ** z trzeciej kolumny dolnego pokładu na czwartą
kolumnę górnego, i pod nią nie ma nic. Ostroga na górze, wcięcie na dole,
pierwszy kadłub w tej grze z sylwetką zamiast obrysu.

**Przeniosła się, nie doszła — i to jest cała różnica.** Pierwsze podejście
DODAŁO wnękę i zostawiło starą na miejscu, co po cichu dało statkowi startowemu
drugi darmowy moduł. *„Pusta wnęka to pierwszy prawdziwy wybór przebudowy"* —
przy dwóch to przestaje być wybór. Sekcja 43 złapała to w następnym przebiegu.

**Płyta kadłuba musiała za tym pójść.** Była jednym zaokrąglonym prostokątem
wokół `roomBounds()`; w chwili gdy Bastet dostała ostrogę, płyta przykryła pusty
kwadrat pod nią i statek startowy wyglądał jak statek z dziurą. Teraz płyta to
**suma modułów**: każdy pokój wrzuca własny prostokąt do jednej ścieżki,
nakładające się wypełnienia scalają się, a obrys chodzi po prawdziwym kadłubie.
Obwódkę robi **podwójne wypełnienie**, nie obrys — obrysowanie ścieżki ze
stykających się prostokątów rysuje też każdą krawędź wewnętrzną.

Szyby wind trzeba było dorzucić osobno: `SHAFT_W` to 30, a moduły po bokach rosną
o `MARGIN` 10 na stronę, więc płyta miała **wygryzione dziesięciopikselowe
wcięcie przy każdej windzie**.

Efekt uboczny: **Sobek od zawsze miała postrzępiony pokład** (górny cztery
kolumny, dolny trzy) i dopiero teraz to widać.

### 5. Trzy rejestry skasowane po drodze

- **Linia chodzenia miała TRZY kopie** — `HULL_GRID.WALK_FRAC`, mnożenie w
  `buildHull` i gołe `0.65` wypisane w `floorWalkY`. Zgadzały się wyłącznie
  dlatego, że sufit był chodliwy; w chwili pojawienia się kanału rozjechałyby
  się o siedem pikseli, czyli winda zatrzymywałaby się nad podłogą, na której
  stoją pasażerowie. Jedno źródło: `walkOffset()`
- **Geometria modułu w pokoju miała TRZY kopie** — budowniczy kadłuba i obie
  ścieżki przebudowy. Jedna metoda: `_fitSystemToRoom()`
- **Pozycja bojowa miała CZTERY kopie** — `180, 180` w trzech miejscach i
  `850, 200` w jednym. Jedno źródło: `Ship.PLAYER_STATION` / `ENEMY_STATION`

### 6. Co pokazał zrzut ekranu (i czego nie widział żaden pomiar)

Cztery rzeczy, po kolei, każda znaleziona **patrzeniem**:

1. **Pokłady stykały się włosem** — `DECK_GAP` 0 bez narysowanego kanału
2. **Odznaka modułu wjechała pod kratkę** — rysowana w `room.y + 3`, czyli
   teraz w kanale. Stąd `_fitSystemToRoom` sadza moduł we WNĘTRZU
3. **Załoga stała w środku nazwy modułu** — „We▮pons". Nazwa siedziała przy
   dolnej krawędzi, co było czystym powietrzem przy module 72 px wysokości;
   przy 60 (z czego 10 to kanał) stopy lądują na tabliczce
4. Przeniesienie nazwy pod sufit **wymieniło kolizję na inną** — plakietki
   załogi zasłoniły ją. Wnętrze 50 px nie pomieści nazwy modułu, ikony, sylwetki
   i plakietki naraz. Nazwa wylądowała **w kanale, przy LEWEJ krawędzi**: trzy
   stanowiska to `cx-26`, `cx` i `cx+26`, więc środek modułu to dokładnie to
   miejsce, gdzie będzie plakietka

### 7. Co wyłapał przebieg łamiący

Pierwszy przebieg po nowych testach złapał **14 z 16** rewersów. Dwa przecieki,
oba pouczające:

- **„linia chodzenia liczona przez sufit"** — moje granice były za luźne.
  `MODULE_H * WALK_FRAC` daje stopy na 39 w module 60 px, czyli dalej pod
  kanałem i nad podłogą. Test pyta teraz o **własność, nie o wzór**: pogrubienie
  kanału nie może przesunąć załogi względem pokładu, na którym stoi
  (dobrze: 0,35 i 0,35; źle: 0,42 i 0,53)
- **„płyta wygryza wcięcie przy windzie"** — asercja przechodziła **na cudzym
  prostokącie**: `elevators.draw` rysuje kabinę 22 px na tej samej osi, więc
  skasowanie pętli płyty niczego nie psuło. Doszedł warunek na pełną wysokość
  kadłuba

Po poprawkach **16/16**.

### 8. Naprawiony trzeci chwiejny test (sekcja 124)

Ta sama choroba co dwa razy wcześniej, trzecie wcielenie. Trzymanie postronnych
na pełnym hp i powietrzu **nie wystarczało**: ciało w tym fragmencie **GNIJE**,
dwadzieścia sekund to dużo przy 5 %/s w tym samym pokoju, a **zarażony sam
wychodzi otwartą śluzą** — i dyspozytor nie ma kogo wysłać. Padało raz na
szesnaście przebiegów. Wyczyszczone tutaj, nie wyłączone nigdzie: zaraza przez
wentylację i człowiek wychodzący włazem mają własne sekcje.

### 9. Przepisany test, który łamał się od komentarza

Sekcja 96 czytała **tekst źródła w oknie 3000 znaków**
(`/this\.label/.test(draw)`). Dwie rzeczy złe naraz: przechodziła na
IDENTYFIKATORZE, a nie na czymkolwiek narysowanym, i była mierzona w BAJTACH —
więc pękła w chwili dopisania komentarza nad etykietą. **Test, który potrafi
wywalić komentarz, to test, który następna osoba wycisza.** Rysuje teraz
prawdziwy moduł i czyta, co wyszło.

### Testy

Nowa sekcja **247**, przepisane **96** i **124**. Razem **4293 asercje + 79
kroków rysowania + 80 w przeglądarce**. `tests/break_check.js`: **411 rewersów**
(16 nowych).

## 5-0ag. ZMIANY update72 (LUDZIE, KTÓRZY NIE SĄ ZAŁOGĄ)

Jedna flaga, `isPrisoner`, i dwóch jej odbiorców — bo to jest dwa razy ta sama
rzecz widziana z dwóch stron: ktoś trzymany w celi na wrogim kadłubie i ktoś,
kto właśnie wyszedł z Twojej.

**To NIE jest drugi `isBeast`.** Więzień to człowiek: ma nazwisko, je, a jak
wróci do domu, jest ręką jak każda inna. Flaga mówi tylko „dziś nie należy do
tej załogi" — i gaśnie w chwili uwolnienia.

### 1. Ratowanie więźniów

* **Wrogi kadłub czasem wiezie ludzi w celi.** Nie każdy — 45 % i tylko tam,
  gdzie jest wolna wnęka po module. Żaden wrogi układ nie ma celi fabrycznie,
  więc pierwsza wersja nie posadziła **nikogo, nigdy, na żadnym kadłubie** —
  i to powiedział dopiero przebieg łamiący, bo dwa rewersy o częstotliwości nie
  dawały się od siebie odróżnić, skoro odpowiedź zawsze brzmiała zero.
* Druga wersja **zabierała wrogowi osłony** pod celę — ładna fikcja, która po
  cichu rozbroiła pół gry; trzy istniejące testy powiedziały to w minutę.
  Trzecia zaczęła zjadać **cloaki** i zgłosiła się statystyka loadoutów.
  **Wersja, która została: cele idą do wnęki, która i tak jest pusta** — tej,
  którą `_spawnEnemy` zostawia, kiedy loadout nie wylosował ani osłon, ani
  cloaka. Nic nie jest zabierane z walki, a na planie statku to widać: kadłub
  bez bańki i bez migotania **może** wieźć ludzi.
* **Wejście do celi JEST ratunkiem.** Bez rozkazu i bez przycisku — decyzją było
  wysłanie ludzi przez próżnię na kadłub z celą.
* **Uwolniony staje się NASZYM człowiekiem na ICH pokładzie** — i to jest cała
  sztuczka, która trzyma tę paczkę małą: odbiór desantu już zgarnia każdego
  `isPlayer` z wrogiego kadłuba, więc powrót, dokowanie, barak i raport to
  maszyneria, która już istnieje. Zero nowego rejestru ludzi.
* **W bazie:** `RESCUE_AT_COST` karmy za każdego (wypłacane **zanim** dowódca
  schodzi z fotela — ta sama pułapka co przy pochówku w update68) i prycza
  w baraku, jeżeli jest wolna.

### 2. Uciekinier przestał znikać za ekranem

update67 zrobił z ucieczki **linijkę tekstu**: zegar celi dobiegał końca,
pojawiał się komunikat i człowiek przestawał istnieć. Projekt gracza mówił co
innego — *„biegnie do śluzy i ucieka… gracz ma realny czas, żeby go zablokować
drzwiami"* — a **tekstu nie da się przerwać drzwiami.**

* Zegar celi stawia teraz **człowieka w korytarzu**, który idzie do najbliższej
  śluzy.
* **Zewnętrzny właz kosztuje go tyle, co każdego obcego: `Door.HACK_TIME`.**
  Trzymasz właz zamknięty — kupujesz sekundy, nie nietykalność, i o to chodzi.
* **Złapanego można odesłać do celi** jednym wierszem w menu, które już jest
  (`CELL`), za tę samą cenę, którą miał wcześniej.
* **Tablica gończa jest zapisywana dopiero, kiedy naprawdę odleci** — wcześniej
  pisała się w chwili otwarcia celi, więc zatrzymanie go nie mogło nic znaczyć.
* Przy okazji: plakat po ucieczce **nie miał kontraktu** (update70 dał adres
  każdemu nazwisku, ale ta gałąź buduje rekord ręcznie) — czyli mapa nie mogła
  go nigdzie posadzić. Człowiek-widmo, do złapania nigdy.

### 3. Czego więzień nie robi — i dwie różne pętle

Okazało się, że strażnik musi stać **w dwóch miejscach**, bo pracę rozdają dwie
różne pętle: `ship._updateBodies` (ciała i zlecenia) oraz własny `update`
załoganta (naprawy, pożary, wyrwy). Pierwsza wersja pilnowała tylko pierwszej —
i więzień **naprawiał moduł statku, z którego próbował uciec**. Znowu: powiedział
to przebieg łamiący, nie ja.

Nikt też nie bije człowieka w kajdankach i on nie bije nikogo — **jedno miejsce**
decyduje, kto jest w tej bijatyce, więc desant wysłany po kogoś nie może go po
drodze zatłuc.

### Dopisane po zrzucie ekranu (update72a)

**Pierwszy raz zobaczyłem tę grę w ruchu** — gracz zaproponował „dam ci tę
satysfakcję", a okazało się, że nie potrzeba do tego kamery: `browser_test.js`
odpala prawdziwe Chromium z grą, więc `page.screenshot()` działa od zawsze
i nigdy tego nie użyłem do PATRZENIA.

Pierwszy zrzut pokazał w sekundę błąd, którego **żaden test nie widział**:
zamknięty kontrakt drukował powód w jednej linii pod opisem, a przy pięciu
kartach (180 px) wychodziło z tego *„They will not hand their pe…"*. Wszystkie
testy przechodziły, bo **ucięty napis z niczym nie koliduje** — mierzyły
nachodzenie, nie czytelność.

Naprawione: **zamknięta karta oddaje całe ciało na powód** — bez opisu, bez
bonusu. Nie ma czego reklamować w zleceniu, którego nie można wziąć. Test
sprawdza teraz to, co było naprawdę złe: czy całe zdanie jest na karcie, słowo
po słowie.

Zostaje drobiazg do paczki graficznej: **tytuł „Strike on Ap…"** też się nie
mieści przy pięciu kartach. Ucięta NAZWA to nadal nazwa, którą się rozpoznaje
i klika — inaczej niż ucięte wyjaśnienie — więc to kosmetyka, nie bug.

**Wniosek na przyszłość: raz na paczkę zrobić zrzut ekranu i na niego spojrzeć.**
Kosztuje minutę i widzi rzeczy, których żaden pomiar nie złapie.

### Dopisane po pełnym przebiegu łamiącym (update72b)

Pełny przebieg 396 rewersów złapał **395** i wypuścił jeden: *#71 the blurb runs
over the line below it again*. Przyczyna jest wprost pochodną poprawki wyżej —
przepisując test zamkniętej karty (mierzył nachodzenie, a miał mierzyć
czytelność) **zabrałem jedyną asercję pilnującą, że opis OTWARTEJ karty kończy
się nad kwotą bonusu**. Zdjęcie limitu dwóch linii daje trzecią linię 12 px nad
liczbą rysowaną w rytmie 13 px — słowa siadają na sobie.

To jest wzorcowy przykład tego, po co w ogóle jest przebieg łamiący: **jedna
poprawka rozbroiła test sąsiadującej rzeczy** i nic poza celowym zepsuciem kodu
by tego nie pokazało.

Dopisane: obie karty — zamknięta i otwarta — mają teraz asercje w **jednym
miejscu**, bo to jeden układ. Odstęp liczony jest **od linii bazowej samego
bonusu**, nie od stałej, więc przesunięcie czegokolwiek w tej karcie test
śledzi sam. Plus zabezpieczenie przed testem, który przechodzi z niewłaściwego
powodu: sprawdzam, że na pasku naprawdę stoi **pięć** kontraktów — gdyby dwa
bramkowane kiedyś zniknęły, karty zrobiłyby się szerokie, opis zmieściłby się
w dwóch liniach przypadkiem i cały pomiar przestałby cokolwiek znaczyć.

### Testy

Nowa sekcja **246**, przepisane **229** i **245**. Razem **4156 asercji + 79
kroków rysowania + 80 w przeglądarce**. `tests/break_check.js`: **396 rewersów,
396 złapanych**.

**Naprawiony drugi chwiejny test (sekcja 124, druga pętla).** Tydzień temu
naprawiłem w niej jedną pętlę w próżni; ta sama choroba siedziała w pętli
pogrzebowej obok. Niosący **otwiera śluzę, żeby wyrzucić ciało — czyli stoi
w próżni kilka sekund** — i czy przeżył, zależało od jego RASY (skafander
Pegasusa ma 26 s powietrza, zwykły 8). Umierał mniej więcej raz na siedem
przebiegów, wylatywał razem z ciałem, i reszta sekcji nie miała już kogo wysłać.

**To jest przy okazji prawdziwe zachowanie gry, nie tylko test:** rozkaz VENT
potrafi udusić człowieka, który go wykonuje. Nie ruszam tego bez Twojej decyzji —
dopisane do §6.3 jako pytanie balansowe.

## 5-0ah. ZMIANY update71 (CELE DODATKOWE I DWA KONTRAKTY)

Dwie pozycje z kolejki, obie zaprojektowane dawno i obie zrobione bez nowego
silnika.

### 1. Cele dodatkowe

Z `projekt-lista-goncza.md` §2, z jego własną zasadą: **cel nigdy nie zmienia
rozgrywki, tylko ją punktuje.** Dlatego wszystkie cztery czytają zdarzenia,
które gra już produkuje — nic nie musiało zacząć się zgłaszać:

| cel | czyta |
|---|---|
| **Cut them down** — wytnij N załogi | `creditKill`, jedyne przewężenie, przez które przechodzi każde nasze zabójstwo (walka wręcz i działka) |
| **Clear the lane** — zniszcz N kadłubów | `_beginDestruction` |
| **Strip the dead** — ogołoć N wraków | `_wreckCleared` |
| **Keep her flying** — ugaś N pożarów | `Fire.suppress`, który od teraz **wie, kto trzyma gaśnicę** |

Dwa cele na kontrakt, nigdy dwa razy ten sam, **liczby wmrożone w rekord
przelotu** — cel to umowa już zawarta, a czytanie tabeli co klatkę przecenia
robotę, którą gracz ma w połowie. Umierają razem z przelotem: to zadania **tego
lotu**, nie drugi rejestr postępu obok kampanii.

**Liczenie i płacenie to dwie różne warstwy.** `save.js` tylko liczy — nie wie
nic o dowódcach, HUD-zie ani o CC zmieniającym właściciela w środku walki.
Wypłaca `game.js`, raz na klatkę, z jednym strażnikiem: `payRunGoal` zwraca
`false` dla już rozliczonego celu. Pierwsza wersja miała **dwóch** strażników i
to był błąd — ten w `game.js` zasłaniał ten właściwy, więc regułę „płać raz" dało
się skasować i nic tego nie zauważyło. Przebieg łamiący to wyciągnął.

**Jedna linia na HUD**, pod paskiem zasobów, i nic poza nią — dokument mówi
wprost: *„nie robimy z tego drugiego ekranu"*. Przy braku celów nie rysuje się
w ogóle.

Przy okazji: `Save.recordKill()` siedziało w `_beginDestruction` **bez pytania,
czyj to kadłub**, więc kampania liczyła „wrogów zabitych" za każdym razem, gdy
gracz tracił własny statek.

### 2. Dwa kontrakty na krańcach karmy (wariant A)

* **Relief Run** — tylko przy **wysokiej** karmie. Dwa sektory, bez bossa, **20 CC
  bonusu** (oni nie mają czym zapłacić). Płaci `RESCUE_AT_COST` karmy i chipem
  z ich laboratorium.
* **No Questions Asked** — tylko przy **niskiej**. Dwa sektory, eskorta warlorda
  na końcu, **160 CC** — i kosztuje `ROBBERY` karmy.

**Progi to `Chips.wallColumn`** — te same pięć pasm, na których stoi plansza CPU.
Dowódca widzi tę linię na własnej planszy; stocznia czyta dokładnie ją. Żadnych
nowych liczb.

**Wariant A znaczy: nic nie znika.** Trzy istniejące kontrakty to **drabinka
trudności** (1/2/3 sektory), nie menu smaków — zamknięcie któregokolwiek za
progiem karmy odbiera grę zamiast dodawać wybór. Te dwa dochodzą obok.

**Zamknięty kontrakt zostaje na tablicy i mówi dlaczego** — zasada zamkniętego
doku z update61. Nie da się go kliknąć ani wystartować; odmowa przy starcie to
to samo zdanie co na karcie, nie drugi sposób powiedzenia tego samego. Obie
nagrody schodzą **przy ukończeniu** (podpisanie to nie czyn) i **przed
dokowaniem**, bo to dokowanie zwalnia dowódcę z fotela — ta sama pułapka co
z karmą za pochówek w update68.

Karta kontraktu dostała limit dwóch linii opisu: przy pięciu kontraktach zrobiły
się węższe i opis wchodził na wiersz z bonusem. **Złapał to test mierzący napisy
z update68**, zanim zobaczył to gracz.

### Testy

Nowe sekcje **244–245**. Razem **4084 asercji + 79 kroków rysowania + 80
w przeglądarce**. `tests/break_check.js`: **368 rewersów**.

**Naprawiony chwiejny test (sekcja 124).** Wywalał się mniej więcej raz na
cztery przebiegi i przez cały update70 udawał przypadkowe usterki. Powód:
test trzyma żywego załoganta 20 sekund w pokoju z **otwartą śluzą** — czyli
w próżni — więc to, czy dożył końca, zależało od jego RASY (skafander Pegasusa
ma 26 s powietrza, zwykły 8 s). Uduszony i wyssany w kosmos zostawiał sekcję bez
nikogo do wysłania. Chwiejny test jest gorszy niż żaden: w przebiegu łamiącym
zamienia „złapane" w rzut monetą.

## 5-0ai. ZMIANY update70 (CZARNY RYNEK, ADRES NA PLAKACIE, GŁÓD)

Pierwsza paczka od update67, która **nie jest listą bugów** — trzy rzeczy
uzgodnione z graczem 2026-09-10 i domknięcie update69.

### 1. Plakat ma adres

Nazwisko na tablicy mówiło tylko „on gdzieś jest", a mapa sadzała **kogokolwiek
z listy na czymkolwiek**. Więc tablica nie mogła powiedzieć, gdzie go szukać —
nie było na to odpowiedzi. Teraz każdy ścigany ma pole `mission`:

* **rozkładają się po różnych kontraktach** — nowy trafia tam, gdzie jest ich
  najmniej (przy czterech nazwiskach i trzech kontraktach różnica to najwyżej
  jeden);
* **tablica WANTED pisze kontrakt** przy nazwisku, czytany z `MISSIONS`, nie
  wpisany drugi raz — plakat mówi dokładnie to samo słowo co pasek startu;
* **mapa sadza tylko swoich**: Courier Run spotyka człowieka ściganego na
  Courier Run. Kontrakt, na którym nikogo nie ma, to spokojny przelot — i o to
  chodzi w rozłożeniu;
* **40 % → 50 %**, bo przy podziale na trzy każdy przelot widzi ich mniej;
* stary zapis dostaje adresy **raz, przy wczytaniu**, i zapisuje je od razu —
  inaczej ścigany zmieniałby kontrakt przy każdym uruchomieniu.

### 2. Czarny rynek — trzy wyjścia

Do tej pory karma poniżej środka była **samą karą**: droższe paliwo, drożsi
ludzie, zamknięte doki. To jest druga strona.

Na węźle ze ściganym, jeżeli **porty już liczą ci narzut**, pirat otwiera kanał:

| wyjście | co robi |
|---|---|
| **TRADE** | otwiera się jego ładownia; **nagroda przepada** (zostaje na tablicy — dopadniesz go na innym kontrakcie), a węzeł przestaje być walką |
| **REFUSE** | walka, która i tak miała być |
| **ACCEPT AND STRIKE** | zgadzasz się i strzelasz: wchodzi **bez bańki osłon**, kosztuje **−5 karmy** (`ROBBERY`) |

**Próg to nie nowa liczba.** `Commander.pirateWillDeal` czyta ten sam pas, co
narzut w portach (≤35), a głębszy rabat bierze z `KARMA_SHUNNED` (≤10). Własny
próg byłby drugą opinią o tej samej reputacji i rozjechałby się przy pierwszym
wyważaniu.

**Rynek to `Station` z flagą**, nie drugi ekran sklepu. Ta sama kasa, ten sam
próbnik ładowni, ten sam UI; zmienia się asortyment i cena. Sprzedaje broń
(więcej niż port), moduł albo dwa z cudzego kadłuba, **kontrabandę i chipy** —
to jedyna rzecz, którą czarny rynek **dokłada** do sklepu zamiast przeceniać.
Nigdy nie odmawia obsługi: `refusal()` czyta karmę, a rynek, który odprawia
jedynych dowódców, dla których istnieje, byłby drzwiami donikąd.

**Przy okazji zamknięty stary dług:** cena broni była liczona **dwa razy** —
w `buyWeapon` i osobno w UI — i rabat trafiłby tylko do jednej z kopii. Teraz
lada podaje cenę (`weaponCost` / `moduleCost` / `goodsCost`), a przycisk ją
czyta. **Port płaci dokładnie tyle co wczoraj**: doliczanie karmy do broni
przebalansowałoby po cichu każdą stację w grze przy okazji paczki o czymś innym.

### 3. Głód ma środek

update69 zabrał automatyczne jedzenie i zostawił FEED jako przycisk, za którym
nic nie stało: głód robił coś dopiero na samym dnie paska, więc uczciwą taktyką
było go ignorować do ostrzeżenia.

`effortFactor()` — jedna metoda, cztery pasma w `HUNGER.EFFORT`, nie cztery
`if`y rozsypane po trzech prędkościach:

| stan | mnożnik |
|---|---|
| najedzony (≥80) | **1,20** |
| normalnie | 1,00 |
| głodny (<40) | **0,75** |
| konający (≤12) | **0,50** |

Mnoży **naprawę, gaszenie pożaru i łatanie wyrwy** — czyli to, co robią RĘCE.
**Nie** działka, nie pilotaż, nie walkę wręcz: głodny wciąż celuje i wciąż bije
się o życie, a wpięcie tego we wszystko zamieniłoby pasek jedzenia w drugi
suwak trudności. Doświadczenie nadal waży więcej niż obiad — głodujący weteran
naprawia szybciej niż najedzony rekrut, i jest na to test.

### Testy

Nowe sekcje **241–243**. Razem **3938 asercji + 79 kroków rysowania + 80
w przeglądarce**. `tests/break_check.js`: **335 rewersów**.

Harness dostał `insertBefore` w atrapie DOM — bez tego sklepu nie dało się
w ogóle otworzyć z testu, więc czarny rynek byłby sprawdzalny tylko z ręki.

## 5-0aj. ZMIANY update69 (DRZWI, JAJO I ZEGAR)

Druga lista z żywej gry po update68. Dziesięć zgłoszeń, w tym jedno
przeprojektowanie: wirus pająków przestał być licznikiem walk.

### 1. Menu pod załogantem, drzwi przestały kraść kliknięcia

Trzy rzeczy w jednym miejscu, bo to był jeden problem:

* **Siatka klikania drzwi to było koło o promieniu 16 px** wokół środka drzwi —
  przy skrzydle szerokim na **6 px**. Pięć razy szerzej niż to, co widać, i
  głęboko w module za nimi. Teraz to prostokąt liczony z `Door.W` / `Door.H`,
  tych samych liczb, którymi drzwi się RYSUJĄ, plus 5 px luzu na mysz. Jedne
  wymiary, nie dwa.
* **Otwarte menu zabiera swoje kliknięcie.** Wcześniej `_handleDoorClick`
  szedł przed menu w tej samej klatce, więc rozkaz VENT otwierał właz.
* **Menu wisi POD człowiekiem** (50 px szerokości zamiast 74). Otwierało się z
  BOKU kursora — a bok to ściana, a na ścianie są drzwi. Pod nogami jest tylko
  podłoga, i menu ląduje w tym samym miejscu przy każdym kliknięciu tego samego
  człowieka.

### 2. Wirus pająków: zegar, nie licznik walk

Największa zmiana w tej paczce i jedyna, która zmienia zasady.

Ukąszenie liczyło się w **bitwach**: przeżyj sześć i umierasz. Z tego wynikały
dwie rzeczy, obie zgłoszone. Roster drukował gołe **„5"** i nic na ekranie nie
mówiło, co to liczy. A przemiana mogła się wydarzyć **wyłącznie w ciszy po
wygranej walce** — człowiek, który umierał, nie mógł umrzeć przy działku, czyli
w jedynym momencie, w którym by to coś znaczyło.

Teraz oba zegary to **sekundy** i chodzą, **kiedy statek leci** — mapa, walka,
ładownia — a stoją w bazie, bo baza nie aktualizuje kadłuba. **Kontrakt to
dokładnie ten czas, który się liczy**, i nie potrzeba do tego drugiej flagi
„czy jesteśmy w locie", która mogłaby się rozjechać. Po **5 minut** każdy.

Cała reszta wynika z tego jednego przeniesienia:

* **Przemiana nie zostawia ciała.** Wcześniej zabijała go na podłodze **i**
  wkładała jajo do ładowni — jeden człowiek, dwie rzeczy do zebrania. Jest jeden:
  zostaje jajo.
* **Jajo leży w pokoju, w którym padł** — rysowane z pozycji zapisanej na
  przedmiocie z ładowni, więc to **ten sam jeden przedmiot**. Sprzedaj je,
  wyrzuć albo daj kotu, a znika i z ładowni, i z pokładu. Im bliżej wyklucia,
  tym mocniej pulsuje.
* **Baza go nie tknie.** Nie trafia na półkę magazynu, nie przechodzi przez
  kasę i nie da się go sprzedać „resztą" na ekranie dokowania. Wraca w ładowni
  i tyka dalej — sprzedać można **tylko w porcie**, i to jest cała furtka.
* **Na cmentarzu jest notatka** — w polu „killed by", które nagrobek i tak już
  rysuje: *„the void-spider virus — he left an egg case"*. Nie drugi rejestr na
  jedno zdanie.
* **Pająki wykluwają się w TYM pokoju**, nie w losowym module.

### 3. Wirus na czerwono wszędzie, nie tylko na statku

Ekran bazy miał własną parę kolorów wpisaną z ręki, więc człowiek z wirusem był
**zielony w baraku** (kolor nieszkodliwej plagi) i czerwony na pokładzie — na
jedynym ekranie, na którym decydujesz, czy go w ogóle zabierasz. HUD i panel
stacji to samo. Wszystkie trzy czytają teraz `Renderer.DISEASE_COL`.

### 4. Jedzenie przestało znikać samo

Jedna linijka w `hungerTick` sięgała za załoganta do ładowni. Przez nią cztery
racje, rozkaz FEED i decyzja, co zabrać na pokład, były dekoracją — ładownia
pustoszała, czy gracz patrzył, czy nie. Ostrzeżenie o głodzie zostaje, więc nikt
nie umiera po cichu; co z tym zrobić, należy do gracza.

**Kot je dalej sam** i to nie jest niekonsekwencja: zwierzęciu nie wydaje się
rozkazu, żeby przestało być głodne.

### 5. Załogant wraca na stanowisko po robocie

Wysłanie kogoś po rannego **nadpisywało mu `homeRoomId`** — czyli jego
STANOWISKO — żeby nie zawrócił w połowie drogi. I nikt tego nigdy nie zapisywał
z powrotem, więc ten, kto zaniósł jednego rannego do medyka, mieszkał tam do
końca walki. Gracz zobaczył to po drugiej stronie szyby: *„przeciwnik jak uleczy
rannego zaloganta to często zostaje w module w którym uleczył"*.

`_errandRoomId` to miejsce, gdzie **pracuje**; `homeRoomId` zostaje tym, gdzie
**należy**. Zlecenie kasuje się samo w chwili, w której nie ma już czego nieść i
nikt nie jest przypisany.

### 6. Oferta, której nie da się zrealizować, nie jest ofertą

* **Drugi kot** był proponowany statkowi, który już ma kota. Odmowa działała i
  była poprawna — zła była **oferta**. Nie pojawia się, dopóki zwierzę żyje.
* **Moduł na maksymalnym poziomie** nie dostaje już oferty ulepszenia.
* **Cena nie filtruje niczego**: „nie stać cię" to prawdziwa odpowiedź na
  prawdziwą ofertę i powód, żeby wrócić bogatszym.

### 7. Shield Tuner usunięty

Stocznia sprzedaje osłony **parami pipów**, a ten event dawał jeden poziom — więc
statek ulepszony eventem liczył osłony inaczej niż ulepszony w stoczni, do końca
przelotu. **Skasowany, nie obłożony wyjątkiem**: event, który trzeba poprawiać,
zanim się go zastosuje, nie ma nic do zaoferowania.

### 8. Abordaż w pustkę

Przycisk BOARD po skończonej walce wysyłał człowieka na wrak, który już nie
przyjmuje gości — *„udał że otwiera drzwi hak i zniknął przepadł"*. Stara
blokada to był cichy `return`, który sprawdzał tylko, czy **istnieje rekord**
przeciwnika. A wrak to wciąż rekord. Teraz pytanie brzmi „czy jest tam kadłub,
do którego warto iść", a odmowa jest **wypowiedziana na głos**.

### 9. Cela tylko dla ściganego z tablicy

Propozycja wzięcia dowódcy żywcem wyskakiwała po każdej walce, a zwykły kapitan
nie ma biura, które by za niego zapłaciło. Gracz wziął go i uznał, że nic nie
dostał. Teraz drzwi celi otwierają się **wyłącznie dla nazwiska z tablicy**, a
tekst w okienku mówi wprost, kiedy za kogoś nikt nie płaci.

### 10. Imiona kotów po angielsku

Sześć z dwunastu było po polsku i były to jedyne polskie słowa na ekranie.

### Testy

Nowe sekcje **236–240** plus przepisane 8, 48 i 82. Razem **3842 asercji + 79
kroków rysowania + 80 w przeglądarce**. `tests/break_check.js`: **303 rewersy**.

Sekcje 8 i 48 są przepisane, bo **kodowały stare zasady**: pierwsza sprawdzała,
gdzie medyk STOI po skończonej robocie (czyli wymagała błędu, który naprawiamy),
druga liczyła walki. Test, który trzeba było zmienić razem z kodem, jest w obu
wypadkach opisany w komentarzu — co kodował wcześniej i dlaczego to było złe.

## 5-0ak. ZMIANY update68 (DZIESIĘĆ ZGŁOSZEŃ Z ŻYWEJ GRY)

Cała lista gracza po przelocie na update67. **Zero nowych mechanik** — dziesięć
rzeczy naprawionych, w tym duch, który chodził za nami od update58.

### 1. DUCH ZŁAPANY: moduł niewidoczny w hangarze

Zgłoszenie z update58 wracało cztery razy i ani razu nie dało się go odtworzyć.
Tym razem gracz dorzucił zdanie, którego brakowało: *„widać dopiero po
następnej wyprawie"*.

`_previewShip` cache'ował narysowany kadłub pod kluczem
`berth | kadłub | wybrana załoga | pozycja` — **wszystko oprócz tego, CZYM ten
kadłub jest**. Więc: spójrz na hangar przed startem, poleć, kup medbay, wróć na
ten sam berth z tą samą załogą — klucz co do znaku ten sam, ekran oddaje statek
sprzed wyprawy. Prostuje się przy kolejnym locie, bo wtedy załoga albo berth już
się różni.

**Wszystkie moje polowania zaczynały się od ZIMNEGO cache'u** — zbuduj statek,
narysuj raz, moduł jest. Bug potrzebował **ciepłego**. Test rysuje teraz hangar
PRZED zmianą; ta jedna linijka to cały test.

`_entryShipCache` obok robiło to dobrze — klucz z serializowanych danych. Dwa
cache na jedną rzecz, jeden adresowany treścią i jeden nie: **najstarsza choroba
tego projektu, i kosztowała pięć paczek szukania.**

### 2. Worki zostawały w magazynie, pochówek nie płacił karmy

Dokowanie przenosi całą ładownię na półkę magazynu **zanim** `returnFromRun`
zobaczy worki — więc pochówek nie odbywał się nigdy, a zmarły załogant lądował
w magazynie między rakietami a rudą. Ciała zostają teraz na statku przez
dokowanie; `returnFromRun` je zdejmuje, chowa i płaci.

Przy okazji: **karma za pochówek nie wchodziła nigdy**, bo dowódca był zwalniany
z fotela dwie linijki przed pochówkiem. Teraz schodzi z fotela na końcu —
zapisanie go przed dokowaniem nadpisałoby nową karmę starą.

### 3. Menu przy ciele — przebudowane

* **VENT to teraz pełny rozkaz:** załogant idzie, bierze ciało, niesie do
  najbliższej śluzy, **sam ją otwiera, wyrzuca i zamyka**. Wcześniej wymagał
  śluzy JUŻ otwartej — i to jest powód, dla którego widziałeś wyszarzony wiersz
  bez szansy zgadnięcia, czego brakuje. Zamyka **tylko tę śluzę, którą sam
  otworzył**, więc hatch otwarty ręcznie do gaszenia pożaru zostaje jak był.
* **Rozkaz WYSYŁA zaznaczonego** zamiast wymagać, żeby już tam stał. Wcześniej
  ustawiał tylko przydział i nikogo nie ruszał — dlatego wyglądało to na martwe.
* **Menu tylko przy zaznaczonym załogancie.** Każdy wiersz to rozkaz, a rozkaz
  potrzebuje kogoś, kto go wykona.
* **Zmniejszone ze 150×20 na 74×16.** Powód odmowy zszedł z wiersza na linię
  komunikatów — klikasz wyszarzony wiersz i dowiadujesz się dlaczego, a menu
  przestało zasłaniać pokój.
* **Ciała rysowane 10 px niżej** (`CrewMember.BODY_DROP`), tą samą stałą czyta
  trafianie myszą — to, co widać, i to, co da się kliknąć, to jedno.

### 4. Bonus %HP dowódcy kumulował się co kontrakt

Potwierdzone: **83 → 86 → 89 → 93**. `reseatMaxHp` liczyło poprawnie od
`baseMaxHp`, ale **to pole nie było serializowane** — więc człowiek zabankowany
w baraku wracał z PODNIESIONYM maxHp jako nową bazą. Jeden darmowy punkt na
przelot, w nieskończoność.

### 5. Skok i ucieczka pytają o to samo

Ucieczka z walki i skok na mapie to ten sam akt fizyczny, a pytały o różne
rzeczy: mapa tylko o paliwo, ucieczka o paliwo, silniki i moc kokpitu — i
**żadna nie pytała, czy ktoś siedzi za sterami**. `_jumpRefusal()` to teraz
jedna odpowiedź dla obu: paliwo, silniki, kokpit **i ręka w kokpicie**.

### 6. Wygrana walka nigdy nie zostawia bez paliwa

Syfon z wraku to rzut monetą, więc gracz, który już był suchy, mógł wygrać
bitwę i dalej nie mieć czym skoczyć — F5 i walka od nowa. Teraz po każdej
wygranej, **jeśli zbiorniki są PUSTE**, jedna cela wychodzi z wraku. Tylko przy
zerze: to jest podłoga pod przelotem, nie dostawa paliwa.

### 7. Piraci z tablicy to nie zwykłe patrolowce

**Tylko ścigani** (decyzja gracza — drabinka trudności zwykłej gry nietknięta):

* **dwa RÓŻNE działa** — dwa zegary ładowania do czytania, nie jeden;
* **zbieg z celi:** cięższe działo, tarcze i cięższy kadłub;
* dostają kadłub z dwiema komorami broni, bo na jednokomorowej fregacie
  uzbrojenie nie miało się gdzie zmieścić i sławne nazwisko latało jak zwykły
  patrol.

**Zniszczenie statku ściganego daje jego ciało** (za połowę ceny, jeśli w
ładowni są dwie kratki). Zwykły wrogi dowódca dalej przepada z wrakiem — cela
zostaje **jedynym** sposobem na wzięcie żywego.

### 8. Dwie choroby, dwa kolory, jedna uleczalna

Obie były tym samym zielonym ☣ i nie dało się ich odróżnić. Teraz jedna tabela
w `renderer.js` czytana przez roster i przez załoganta na pokładzie:

* **plaga** z gnijącego ciała — **zielona**, pulsująca, nie zabija, **medykamenty
  ją leczą**;
* **wirus pająków** — **czerwony**, pulsujący, z odliczaniem walk do śmierci.
  Medykamenty na niego **nie działają** i to jest celowe: ukąszenie ma być
  zegarem, którego nie da się wykupić. Klinika na stacji zostaje jedynym lekiem.

**SICK nie zasłania już HP.** Znacznik zastępuje pasek tylko wtedy, gdy punkty
życia nic nie mówią — trup, gnijący, leżący. Chory to znak OBOK paska.

Medykamenty robią teraz to, czego nie robi nic innego na statku (HP dają
jedzenie i medbay), a przy nikim chorym wracają do opatrywania rany.

### 9. Lista tych, którzy nie wrócili

Nagrobek mówi, że ktoś zginął. **Nie mówi, czy ktoś go przywiózł** — a dowódca
nie miał nagrobka w ogóle, więc dało się stracić czterech przez kampanię i nie
mieć nigdzie śladu.

Panel **NOT RECOVERED** obok cmentarza, czytany prosto z listy grobów po tym
jednym polu, które zapisuje pochówek. **Nie drugi rejestr zmarłych — ta sama
lista, przefiltrowana.** Kot, dowódca i załogant mają różne znaczniki: strata
zwierzęcia to nie strata dowódcy.

### 10. Napisy nachodzące na siebie w bazie

Linia regionu z update58 weszła na x=60, cztery piksele nad słowem CONTRACT,
które siedzi na x=56 od update53 — przechodziły przez siebie **na każdej
zakładce bazy**. Nic tego nie złapało, bo **nic nigdy nie MIERZYŁO tego ekranu**.

Więc test nie sprawdza tej jednej linii: **mierzy każdy napis, jaki baza rysuje,
na dziewięciu zakładkach**, i wywala się na każdej parze, która dzieli linię
bazową i nachodzi poziomo. Uwzględnia wyrównanie — połowa tego ekranu jest
wyrównana do prawej albo do środka, a traktowanie kotwicy jak lewej krawędzi
wymyśla nakładki, których nie ma, i ukrywa te, które są.

### Testy

Nowe sekcje **230–235** plus przebudowane 124 i 219. Razem **3687 asercji + 79
kroków rysowania + 80 w przeglądarce**.

**Sekcja 235 to wynik przebiegu łamiącego, nie plan.** Pierwszy przebieg
(275 rewersów) przepuścił **czternaście** poprawek: każda miała test *części* —
`_bagWantedCommander()` wołane ręcznie, pochówek przez ręczne `returnFromRun`,
BAG przy kimś już stojącym nad ciałem — i **żaden nie wchodził przez drzwi
frontowe**. Wyrzucenie WYWOŁANIA z `_onWin`, z dokowania, z kliknięcia nie
psuło niczego w suicie.

Reguła stąd, na przyszłość: **funkcja, do której nikt nie dociera, to funkcja,
której nie ma.** Test części nie jest testem — sekcja 235 dokuje statek, wygrywa
walkę, traci statek i klika wiersz, i sprawdza to, co zobaczyłby gracz.

`tests/break_check.js` przyjmuje teraz opcjonalny filtr:
`node tests/break_check.js "#68 the menu"` — pojedynczy rewers sprawdza się
w kilkadziesiąt sekund zamiast czterdziestu minut. Bez argumentu leci komplet
jak dotąd.

## 5-0al. ZMIANY update67 (SPŁATA DŁUGÓW)

Bez nowej mechaniki. Trzy długi zamknięte, jeden bug zamknięty inaczej niż
naprawą, i jedna decyzja balansowa gracza zapisana.

### Bug modułu medyka — ZAMKNIĘTY JAKO NIEODTWARZALNY

Zgłoszenie z update58: *„jak zamontowałem medic modul to jak wróciłem do bazy
nie był wyświetlany jako moduł w hangarze"*. Szukany przez **pięć paczek**.

W tej paczce prześledziłem **cały łańcuch z opisu, na wszystkich trzech
kadłubach**: zakup w porcie przez `buyNewModuleAt` w klikniętym pokoju →
`serialise` → `returnFromRun` → rekord w hangarze → `_entryLevels` → **tekst,
który ekran bazy naprawdę rysuje**. Moduł jest obecny na każdym etapie i na
każdym kadłubie. Sprawdziłem też najprawdopodobniejsze pozostałe wyjaśnienie —
że pasek modułów wyrasta poza kartę na obładowanym kadłubie — i on też się
mieści (hauler z ośmioma modułami, wszystkie na ekranie).

**Nie da się naprawić czegoś, czego nie da się zobaczyć.** Więc zamiast trzymać
to otwarte w nieskończoność, cały ten łańcuch jest teraz **sekcją testową 227**.
To nie jest poprawka — to zabite drzwi. Jeżeli kiedykolwiek się zepsuje, zepsuje
się tam, a nie w czyimś przelocie.

Jeżeli jeszcze na to trafisz, potrzebuję: **kadłub, gdzie kupiony, czy hangar
był pełny** — i najlepiej zapis.

### Jeniec je (dług z update63)

Jeden posiłek **na skok**, z tej samej ładowni co reszta załogi. To jest
prawdziwy koszt wiezienia człowieka do domu: nie cela, tylko **racje**. Ładownia
zapchana rudą i bez jedzenia to ładownia, która zagłodzi Ci nagrodę w drodze
powrotnej.

Raz na skok, nie co klatkę — głód jeńca to decyzja przy skoku („mam dla niego
żarcie?"), a własny pasek głodu byłby drugim systemem głodu obok załogowego.

**Zagłodzony jeniec umiera i zostaje ciałem** — dalej wart połowę, jeśli w
ładowni jest miejsce. Ta sama para cen co wszędzie, więc zagłodzenie go jest
stratą, a nie sprytnym wyjściem z problemu karmienia.

### Uciekinier wraca na tablicę — DROŻSZY I MOCNIEJSZY (decyzja gracza)

Zbieg z celi idzie z powrotem na listę gończą: **+50 % nagrody**, **+2 poziomy**
i **twardszy statek oraz załoga** w następnym spotkaniu. Gracz podjął tę decyzję
wprost i miał rację: *„również staje się silniejszy, większy lev i mocniejszy
statek i załoganci"* — bo pirat, który jest tylko **droższy**, byłby darmowymi
pieniędzmi dla załogi, która raz już go pobiła.

**`escapes` to JEDEN rejestr, z którego bierze się wszystko:** poziom rośnie od
niego, cena rośnie od ceny, a walka czyta go po to, żeby dać mu lepszy kadłub
(`difficulty = 'hard'`) i dowódcę **przerolowanego na rangę z plakatu**. Plakat,
który obiecuje poziom 12, a sadza zwiadowcę na poziomie 3, to kłamstwo, za które
gracz płaci przygotowaniem się do niewłaściwej walki.

Sufit tablicy dalej obowiązuje — pełna tablica nie rośnie o piątego człowieka
dlatego, że komuś otworzyła się cela. Cudza cela to nie sprawa naszego portu.

### Hull Cannon — ZOSTAJE JAK JEST (decyzja gracza)

3 mocy, 1 rakieta na strzał, 18 s ładowania, rakieta 6 CC. Cztery strzały i
zapas znika. **To ma być drogie działo dla kogoś, kto planuje zapas** —
komunikaty ostrzegają od update59, gracz ma informację i decyduje sam. Sprawa
zamknięta, wypisana z TODO.

### Testy

Sekcje **227–229**: cały łańcuch modułu medyka na trzech kadłubach **aż do
narysowanego napisu** plus obładowany hauler; jeniec je z ładowni, zagłodzony
zostaje ciałem za pół ceny, pełna ładownia nie ma go gdzie położyć, dwóch jeńców
i jeden posiłek; zbieg wraca droższy **i o dwa poziomy wyżej**, druga ucieczka
liczy się osobno (licznik liczy, nie zatrzaskuje się), **walka sadza rangę,
którą obiecała tablica**, sufit trzyma, a cudza cela nie trafia na naszą
tablicę. Razem **3570 asercji + 79 kroków rysowania + 80 w przeglądarce**.

### Przebiegi łamiące

`break_check.js` ma **243 rewersy** (19 nowych dla update67). Przebiegi:
**239/243 → 243/243.** Cztery luki, i **wszystkie cztery to jedna rodzina, ta
sama co poprzednio: testowałem regułę, a nie drogę, którą gra do niej dochodzi.**

* **Jeńcy byli karmieni ręcznie w każdym teście.** Skasowanie jednej linijki w
  `_nextSector` zostawiło wszystkie na zielono — jeniec po prostu nigdy nie
  robił się głodny przez resztę przelotu. Doszedł test, który **skacze do
  następnego sektora** i patrzy na ładownię.
* **Napis „Medbay" jest na tym ekranie w DWÓCH miejscach** — na schemacie
  kadłuba i na liście modułów. Sprawdzanie „czy słowo gdzieś padło" przechodziło
  na budowie z uciętą listą: schemat dalej pisał, lista nie. A zgłoszenie było o
  LIŚCIE. Teraz liczone są oba miejsca.
* **Zbieg „wraca jako niewidziany" porównywało `wanted` z `wanted`** — plakat w
  teście nigdy nie był oznaczony jako widziany, więc kasowanie resetu nic nie
  zmieniało.
* **Lepszy kadłub zbiega nie miał testu w ogóle.** Ranga dowódcy była
  sprawdzona, statek pod nim nie. Teraz ten sam człowiek na tym samym ziarnie
  jest porównywany w dwóch wariantach — po ucieczce i bez — i kadłub musi być
  cięższy.

## 5-0am. ZMIANY update66 (POLOWANIE NA MAPIE + CZTERY RACJE)

Dwie rzeczy: reszta `projekt-zwloki-racje.md` (§2) i naprawa dziury, którą
gracz znalazł pytaniem *„jak zeskanuję sektor i będzie pirat na mapie, to go
będę widział?"*. Odpowiedź brzmiała: **nie** — i to była realna wada, nie brak
funkcji.

### Lista gończa była loterią, nie polowaniem

Do update65 ścigany był **losowany w chwili startu walki** (35 %). Skutek: każdy
węzeł walki wyglądał identycznie, Survey Probe odsłaniał typy węzłów i nic o
ludziach, a gracz dowiadywał się, na kogo wpadł, **po rozpoczęciu strzelaniny**.
Nie dało się na nikogo polować.

Teraz **plakat jest przypięty do WĘZŁA** przy generowaniu sektora:

* węzeł rysuje się pomarańczowo, z czaszką zamiast skrzyżowanych ostrzy, **jego
  nazwiskiem zamiast słowa „Enemy"** i kwotą pod spodem;
* **Survey Probe dostaje drugi powód, żeby istnieć** — skan mówi „on tu jest i
  siedzi w tym węźle";
* **`WANTED_ENCOUNTER_CHANCE` SKASOWANE.** Walka nie losuje już nic, tylko czyta
  węzeł. Dwie odpowiedzi na pytanie „czy to jego walka" rozjechałyby się przy
  pierwszym strojeniu którejkolwiek;
* **40 % sektorów** (decyzja gracza). Zawsze = pewniak i tanio; nigdy = z
  powrotem loteria. Czasem trzeba przelecieć dalej i to jest polowanie.

**Węzeł niesie ID, nie kopię.** `node.wanted` czyta tablicę przez
`Save.wantedById`, więc oddanie człowieka **zmienia węzeł na starej mapie** —
przestaje go nazywać i wraca do zwykłego czerwonego.

**Losowanie idzie z RNG MAPY, nie z `Math.random`.** Sektor jest odbudowywany z
`run.seed` przy każdym wczytaniu — plakat postawiony luźnym `Math.random`
**przeskakiwałby na inny węzeł po każdym reloadzie**, czyli polowanie dałoby się
save-scumować. Ziarno naprawia to jedną linijką.

**Jego węzeł GWARANTUJE dowódcę.** Nie każdy statek ma dowódcę (samotny zwiadowca
w sektorze 1 to samotny zwiadowca) — ale wlecieć na pole, po które przeleciało
się przez pół sektora, i nie zastać tam nikogo do złapania, byłoby okrutne.
Znalazł to test rzutem 0.99.

Na tablicy w bazie `last seen` pokazuje teraz **księżyc I SEKTOR** — sam księżyc
był za grubo, żeby na tym planować lot.

### Cztery racje

| racja | najedzenie | pola | cena | mięso |
|---|---|---|---|---|
| Protein Paste | 25 | 1 | 5 CC | tak |
| **Ration Pack** *(bez zmian)* | **50** | 1 | 8 CC | tak |
| Field Meal | 80 | **2** | 16 CC | tak |
| Green Ration | 50 | 1 | 12 CC | **nie** |

**Zwykła racja zostaje na 50** — obniżenie jej do 25 byłoby po cichu
podwojeniem zużycia żarcia w całej grze. Uczucie „trzeba częściej brać jedzenie"
daje **tania Protein Paste**: kto oszczędza, ten lata po żarcie częściej. To
Twój wybór przy pakowaniu, nie podatek nałożony wszystkim.

**Różnica jest w POLACH, nie w cenie za punkt najedzenia** (ta jest podobna) — a
ładownia jest w tej grze prawdziwą walutą od update24.

**`HUNGER.FOOD.ration` SKASOWANE.** Wartość posiłku siedzi teraz na przedmiocie,
bo przy czterech racjach nie ma czegoś takiego jak „ta" racja do odpytania.
Szczur i jajo pająka zostają w `HUNGER.FOOD` — **nie są ładunkiem**, więc to
podział wg rodzaju, a nie druga kopia tej samej liczby.

**Kot nie je Green Ration.** To ważniejsze, niż wygląda: dzięki temu flaga
`meat` **ma żywego czytelnika już dziś**, zamiast być martwym polem czekającym
na religie. Kiedy dojdą wierzenia załogi, dopisują reguły do `willEat` i nigdzie
indziej. Kot głodujący nie otworzy zieleniny nawet sam z siebie — pytanie zadaje
i automatyczny posiłek, i rozkaz.

**FEED jako rozkaz.** Prawy przycisk na stojącym załogancie. Dziś głodny sam
sięga po ostatnie pudełko i gracz nie ma nic do powiedzenia; teraz może wskazać,
kto je. Menu z update65 **zmienia wiersze zależnie od stanu** — stojący dostaje
FEED, leżący TREAT/VENT/BAG. Cztery stałe wiersze z trzema martwymi byłyby w
trzech czwartych szumem. Odmowa idzie przez `feedRefusal`, tę samą funkcję,
której pyta menu — kształt z update65.

**Porty sprzedają jedzenie.** Każdy ma coś (nikt nie utknie z pełną sakiewką),
ale **nie każdy ma wszystko** — inaczej cztery racje byłyby listą zakupów, a nie
decyzją. Który port ma co, wynika z jego ziarna, więc port, po który wracasz, ma
to, po co wracasz. **Baza dalej sprzedaje tylko standardową rację** — kwatermistrz
wydaje przydział, różnorodność jest w portach.

### Testy

Sekcje **222–226**: rozkład plakatów po 40 ziarnach, **ten sam seed daje ten sam
węzeł i tego samego człowieka**, nigdy boss i nigdy pierwszy skok, węzeł jako
wskaźnik (oddany człowiek przestaje być nazywany na starej mapie), pusta tablica
= nikt nigdzie; **jego węzeł sadza go przy rzucie 0.0 I 0.99**, zwykły węzeł nie
sadza nikogo przy żadnym z nich (to jest asercja, która by padła, gdyby stary
35 % rzut wciąż żył obok mapy), sygnalizacja z sektorem; cztery racje —
wartości, pola, ceny, **skasowana stara tabela**, jedzenie czyta pudełko;
kot i zieleniny w obie strony, FEED odmawiający dosłownie tym samym zdaniem co
menu, menu zmieniające wiersze; port zawsze z jedzeniem, nie zawsze ze
wszystkim, zapłata za to, co się zmieściło, pełna ładownia odmawiana **zanim
ruszy CC**. Razem **3501 asercji + 79 kroków rysowania + 80 w przeglądarce**.

### Przebiegi łamiące

`break_check.js` ma **224 rewersy** (25 nowych dla update66). Przebiegi:
**222/224 → 222/224 → 224/224.** Trzy luki łącznie i **wszystkie trzy to test
przechodzący z niewłaściwego powodu** — dwie z nich wyszły dopiero w drugim
przejściu, a jedna zdążyła w pierwszym przejściu przejść PRZYPADKIEM:

* **Kot je przez `petTick`, nie przez `hungerTick`.** Załoga karmi się w jednej
  funkcji, zwierzę w drugiej — a test kręcił tylko tę pierwszą. Czyli na
  budowie, na której kot POSZEDŁBY po zieleninę, nikt mu jej nigdy nie
  zaproponował i asercja i tak przechodziła.
* **Ruda była odmawiana za brak w magazynie, nie za to, że nie jest jedzeniem.**
  Właściwa odpowiedź z niewłaściwego powodu: sprawdzenie tagu dało się skasować,
  a test dalej świecił na zielono. Teraz ruda jest wprost wstawiona do stocku
  racji i test czyta POWÓD odmowy, nie tylko fakt.
* **Determinizm plakatu sprawdzany na JEDNYM sektorze.** Sektor, w którym jest
  tylko jeden kwalifikujący się węzeł walki, daje ten sam wynik **niezależnie od
  tego, jak się losuje** — więc rewers z luźnym `Math.random` przeszedł w
  pierwszym przejściu i wyłożył się w drugim. To był rzut monetą udający test.
  Teraz sprawdzane jest czterdzieści sektorów naraz; przy cofniętej poprawce
  jedenaście z nich przestawia człowieka.
* Do tego dwie asercje o kocie były **prawdziwe także na budowie, na której kot
  ZJADŁ zieleninę**: posiłek zaczęty i skończony w pętli zostawia `_meal` z
  powrotem na `null`, a pudełko racji to STOS pięciu — zjedzenie jednej zostawia
  pudełko na półce z czterema. Teraz test czyta **głód kota i liczbę w stosie**.

## 5-0an. ZMIANY update65 (CIAŁO TO DECYZJA, NIE SPRZĄTANIE)

`projekt-zwloki-racje.md` §1 w całości. Druga połowa tego projektu (cztery
racje) idzie osobno — w jednej paczce nie dałoby się uczciwie przetestować ani
jednej, ani drugiej.

### Dwie rzeczy z projektu okazały się nieaktualne

**Zmarły trafia na cmentarz w chwili śmierci** (`crew.js:1465`), nie po
pochówku. Więc „przywieź ciało, żeby trafił na memoriał" **zbudowałoby drugi
rejestr tych samych ludzi**. To, czego cmentarz nie wiedział, to **czy wrócił
do domu** — i to jest POLE na istniejącym rekordzie (`buried`), nie nowa lista.

**`body_bag` już istniał** — zrobiony w update63 dla ciała wrogiego dowódcy.
Dwa worki 2×1 z różnymi zasadami to choroba dwóch rejestrów, więc jest **jeden
przedmiot i jedna pętla na doku**, a `meta` mówi, po co go wieziesz: nagroda
(CC) albo swój człowiek (pochówek, karma, zero CC).

### Kto decyduje o ciele

Stara zasada brzmiała: **otwarta śluza**. Otworzyłeś ją, żeby zgasić pożar — i
twoi zmarli wylecieli razem z dymem, bez pytania. Alert o rozkładzie mówił
„otwórz śluzę", a resztę robił automat. Czyli jedyny moment, w którym ciało
jeszcze do czegoś należało, przechodził bez zadania pytania.

Teraz **prawy przycisk myszy na leżącym** otwiera menu:

```
TREAT   ranny → nosze do medyka        (istniejąca ścieżka, teraz jako priorytet)
VENT    ciało → śluza                  (istniejąca ścieżka, teraz na rozkaz)
BAG     ciało → ładownia, 2 pola       (kot: 1 pole)
```

**Prawy przycisk, nie lewy — i to jest poprawka błędu, który sam popełniłem w
tej paczce.** Pierwsza wersja otwierała menu lewym klikiem i w minutę złamała
najstarszą zasadę tego ekranu: trzej ranni leżący w rozwalonym module zjadali
każde kliknięcie w ten moduł, więc **nie dało się wydać rozkazu naprawy**. To
dokładnie bug z update34, odkryty ponownie przez jego własny test. Menu
kontekstowe to gest kontekstowy — prawy klik nie wchodzi w drogę żadnemu
istniejącemu rozkazowi i nie potrzeba reguły, kto wygrywa.

**Ranni zostają bez zmian.** Nadal są zbierani sami — człowiek wykrwawiający się
na podłodze to nie decyzja, to nagły wypadek. Zmieniła się tylko droga ZMARŁEGO.

### Każda odmowa ma powód

`bodyRefusal(body, act)` — **jedna funkcja**, którą pyta i menu (żeby wyszarzyć
wiersz), i rozkaz (żeby odmówić). Wiersz nie może wyglądać na żywy i nic nie
zrobić, a powód jest **wypisany na wierszu**, nie zostawiony do zgadnięcia —
zasada zamkniętego doku z update61. Menu poszerzone z 96 na 150 px właśnie
dlatego: przy 96 powód ucinał się na „no ro…", czyli szary prostokąt z szumem.

Geometria menu to **jedna funkcja** `Renderer.bodyMenuRects` — rysowanie i
trafianie czytają stamtąd, i menu **nie otwiera się poza ekranem**, bo ciało
może leżeć przy samej krawędzi.

### Cena i zapłata

* **VENT swojego zmarłego: −3 karmy.** Wyrzucenie za burtę jest darmowe w CC i o
  to chodzi — cena jest tam, gdzie karma ją widzi. Płatne **tylko za rozkaz**:
  człowiek, który sam wyszedł śluzą (plaga), to nie jest niczyja decyzja.
* **BAG + dok: +3 karmy**, zero CC, i **worek swojego nie ma ceny w żadnym
  porcie** — nie sprzedasz własnych zmarłych przelatującemu handlarzowi.
* Płacone **raz**: worek schodzi z kadłuba razem z zapłatą, ten sam kształt, co
  nagroda za ściganego.
* Na cmentarzu każdy grób mówi teraz **„brought home and buried"** albo
  **„no body recovered"**.

### Czego tu NIE MA

* **Czterech racji** — następna paczka.
* **BAG nie jest chodzeniem.** Rozkaz wymaga żywej ręki W TYM POKOJU i dzieje
  się na miejscu. Wymyślanie drugiej trasy noszenia dla roboty, która odbywa się
  nad ciałem, byłoby drogą donikąd.
* Zapłata za pochówek nie zależy jeszcze od wyznania — patrz §6.2.

### Testy

Sekcje **218–221**: otwarta śluza **nie** wyrzuca ciała (2000 klatek), rozkaz
wyrzuca; ranny zbierany bez rozkazu; wszystkie odmowy z powodem i **rozkaz
powtarzający dosłownie powód z menu**; BAG zajmuje 2 pola, kot 1, pełna ładownia
odmawia **zanim cokolwiek się ruszy**, worek swojego wart 0 CC; −3 za śluzę,
**0 za człowieka, który wyszedł sam**, +3 za pochówek, drugie dokowanie tego
samego kadłuba nie chowa nikogo drugi raz, worek nagrodowy dalej płaci CC;
geometria menu — żadne dwa wiersze się nie nakładają, każdy w swoim panelu,
**menu otwarte w pięciu rogach ekranu zostaje na ekranie**, napisy padają w
swoich prostokątach, powód drukuje się tylko na odmówionym wierszu.
Razem **3429 asercji + 79 kroków rysowania + 80 w przeglądarce**.

### Przebiegi łamiące

`break_check.js` ma **199 rewersów** (26 nowych dla update65). Przebiegi:
**194/198 → 198/199 → 199/199.** Pięć luk łącznie, i cztery z nich to jedna
rodzina: **testowałem połowę pary.**

* **Rysowanie menu było sprawdzone, trafianie nie.** Obie strony pytają
  `bodyRefusal`, ale test czytał tylko narysowany tekst — więc trafianie, które
  przestało pytać, dalej szarzyło wiersz i **wykonywało rozkaz mimo to**. To
  jest gorsze niż żywy przycisk: gracz dostaje „nie" i gra to robi. Do harnessu
  doszły `_bodyMenuHit` / `_bodyUnderCursor`.
* **Wysyłanie ręki po ciało szło za smrodem, nie za rozkazem** — i nikt tego nie
  widział, bo przy cofniętej regule człowiek podchodził, reguła podnoszenia
  odmawiała mu, ciało nie ruszało się tak czy inaczej. Widać to **wyłącznie**
  po tym, kogo oderwało od roboty.
* **Pole `buried` nikt nie rysował.** Zapisane na rekordzie, niepokazane na
  nagrobku — czyli gracz i tak by się nie dowiedział. Test najeżdża na krzyż i
  czyta kartę.
* **`markBuried` można było wywołać dwa razy** — przez dok się nie da (worek
  schodzi z ładowni razem z zapłatą), ale funkcja jest eksportowana, więc jej
  kontrakt jest realną rzeczą do sprawdzenia, a nie linią nie do złamania.

Piąta luka była inna i warta zapamiętania: **rewers, który niczego nie cofał.**
Zepsułem pierwsze z DWÓCH wyszukiwań w `markBuried`, a drugie (fallback po
nazwisku) dalej znajdowało człowieka. Skrypt zgłosił lukę i miał rację — nie w
teście, tylko w moim rewersie.

### Przy okazji: §6 przepisana

TODO w tym dokumencie było śmietnikiem — cztery kopie tej samej otwartej sprawy,
wpisy sprzeczne z rzeczywistością, zadania zamknięte trzy paczki temu. Teraz jest
**jedna aktualna lista** z tabelą liczb do wyważenia i miejscem w kodzie dla
każdej. Historia zmian była i zostaje w §5-0*.

## 5-0ao. ZMIANY update64 (LISTA GOŃCZA)

`projekt-lista-goncza.md` §1 w całości. update62 postawił wrogiego dowódcę w
drzwiach, update63 dał celę — ta paczka daje **powód, żeby go szukać**.

### Cela łatwiejsza do znalezienia (prośba gracza)

Szansa na celę na stacji: **30 % → 60 %**, czyli tyle co tarcza. Powód wprost od
gracza: *„do testów przyda się, abym łatwiej ją trafił"*. I ma rację poza samymi
testami — cela, której nie znajdujesz, oznacza, że drzwi „Take him prisoner"
nigdy się nie otwierają, więc cała połowa gry o nagrody jest niesprawdzalna.
**To jest liczba do grania, nie ostateczna** — do rewizji przy balansie.

### Lista gończa — JEDEN rejestr

Rekord piraty żyje **wyłącznie** w zapisie meta-progresji (`_data.wanted`), obok
cmentarza. Walka go NIE KOPIUJE: wylosowany dowódca dostaje `wantedId` i
wszystko dalej — cena, stan, wypłata — wraca przez `Save.wantedById`. Dokument
projektowy nazywa dwie kopie piraty największym ryzykiem tej paczki i to jest
dokładnie ta linia, w której by powstały.

```
{ id, name, race, level, bounty, state: 'wanted' | 'sighted', region }
```

* **Nagroda z poziomu:** `80 + poziom*20`. Ciało = **połowa tej liczby**,
  liczona przy sprzedaży, nie zapisana obok.
* **Sufit: 4 plakaty naraz.** `addWanted` odmawia ponad sufit, nie przycina —
  „lista rośnie w nieskończoność" to trzecie ryzyko z projektu.
* **Jeden nowy po każdym kontrakcie**, losowany **wewnątrz callbacku dokowania**
  — bo oddanie jeńca dzieje się w `returnFromRun`, więc człowiek oddany na tym
  samym dokowaniu zdążył już zejść z listy i zwolnić miejsce. Losowanie linijkę
  wcześniej po cichu zaniżałoby tablicę o jeden do końca gry.
* **Żadnych dwóch plakatów z tym samym nazwiskiem.**

### `null` to nie to samo co `[]` (błąd znaleziony przez własny test)

Pierwsza wersja migracji brzmiała „nie ma nazwisk → to stary zapis, dopisz
jednego". I działała — **oraz po cichu dorzucała nowego piratę za każdym razem,
gdy gracz, który złapał wszystkich, przeładował grę.** Czyli drugie źródło
piratów obok losowania po kontrakcie. Test spotkania złapał to natychmiast:
znalazł ściganego na tablicy, którą sam przed chwilą wyczyścił.

Teraz `wanted: null` w domyślnym zapisie znaczy „ta gra nigdy nie miała
tablicy" i dostaje startowe nazwisko; `wanted: []` znaczy „gracz złapał
wszystkich i czeka na kontrakt" i **zostaje puste**.

### Tylko dok zamyka sprawę

Zabicie nie kończy zlecenia — trup na polu bitwy to nie dowód. Sprawę zamyka
**dostarczenie**: jeniec z `wantedId` albo worek z `wantedId`, oddane przy
doku. `Base.returnFromRun` woła `Save.deliverWanted`, który jest **no-opem dla
id, którego nie ma już na liście** — i to jest cały mechanizm, przez który
zadokowanie tego samego kadłuba drugi raz nie płaci ponownie.

Zwykły dowódca (nie z listy) **dalej płaci** nagrodę z update63 i **nie zamyka
żadnej sprawy** — dwie osobne rzeczy, osobna asercja.

### Tablica w bazie

Nowa zakładka **WANTED**. Czyta `Save.wanted()` **przy każdej klatce** — żadnej
kopii, żadnego odświeżania na zmianę zakładki. Dlatego oznaczenie kogoś jako
widzianego w walce jest widoczne w bazie bez jednego dodatkowego wywołania, i
dlatego ten ekran nie może się rozjechać z walką.

Pokazuje: nazwisko, korporację (kolorowy pasek, żeby dwa nazwiska nie czytały
się tak samo), poziom, **obie ceny**, i czy ktoś go w ogóle widział — „no
sighting yet" to co innego niż „last seen: Luna". Pusta tablica **tłumaczy
się**, zamiast rysować nic.

**Zero przycisków**, świadomie: plakat zamyka się lotem, nie kliknięciem — ta
sama zasada, która trzyma przycisk BUILD z dala od ekranu Bramy.

### Czego tu NIE MA

* **§2 projektu — cele dodatkowe** („zabij 10 załogantów", licznik na HUD).
  Osobna paczka.
* Uciekinier z celi **nie wraca na listę** — teraz już jest gdzie go wpisać,
  więc to jest tanie i idzie do TODO.
* Piraci z listy **nie mają jeszcze własnych statków ani zachowania** — spotkanie
  to zwykła walka, w której dowódca ma nazwisko z plakatu.

### Testy

Sekcje **214–217**: migracja starego zapisu (**prawdziwy zapis z wyciętym jednym
polem**, nie dwupolowy kikut, który nie wczytuje się w ogóle), przeżycie
przeładowania, **`wantedById` zwraca ŻYWY rekord, nie kopię**, sufit z odmową
zamiast przycinania, unikalność nazwisk, **pusta tablica zostaje pusta po
przeładowaniu**; spotkanie z przybitym rzutem — plakat na dowódcy przez `id`,
**dokładnie jeden rekord tego człowieka**, brak ściganego przy rzucie chybionym
i przy pustej tablicy; złapanie **nie** zamyka sprawy, dokowanie zamyka i płaci
raz, drugie dokowanie tego samego kadłuba nie płaci nic, ciało płaci połowę,
worek bez `wantedId` płaci i nie zamyka nic; zakładka mieści się na ekranie,
**oznaczenie widzianego zmienia ekran bez odświeżenia**, i zero przycisków.
Razem **3340 asercji + 79 kroków rysowania + 80 w przeglądarce**.

### Przebiegi łamiące

`break_check.js` ma **172 rewersy** (24 nowe dla update64). Przebiegi:
**166/173 → 172/172.** **Siedem luk w pierwszym przejściu — najgorszy wynik od
update54** i wszystkie siedem to jedna choroba: *test sprawdzał to, co sam
przed chwilą wpisał.*

* **Pięć testów budowało jeńców i worki RĘCZNIE.** Rekord niósł `wantedId`,
  bo **test go tam włożył**, a nie dlatego, że gra go tam wkłada — więc
  skasowanie stempla w `game.js` niczego nie psuło. Naprawione jednym blokiem
  end-to-end, który nie dotyka żadnego rekordu: spotyka człowieka, czyści mu
  pokłady, klika przycisk i **czyta, co zbudowała gra** — łącznie z ceną
  odczytaną z NAPISU na przycisku.
* **Unikalność nazwisk była rzutem monetą.** Cztery losowania z dziesięciu
  kolidują mniej więcej co drugi raz, więc test przechodził na wersji losującej
  ze zwracaniem. Teraz trzydzieści prób przeciwko czterem zajętym nazwiskom.
* **Cena z poziomu porównywała rekord z tą samą funkcją, która go wypełniła** —
  czyli przechodziła też przy `wantedBounty = () => 100`. Teraz sprawdza, że
  wyższy poziom jest wart więcej i że krok jest równy.
* **Szansa na celę nie miała testu w ogóle** — 60 % i 5 % wyglądały identycznie.
* Do tego dwie rzeczy **skasowane, nie przetestowane**: stan `delivered` i filtr
  na niego. Oddany człowiek jest **usuwany** z listy, więc `wantedById` już
  zwraca `null` — strażnik na stan, którego nic nie ustawia, był kodem nie do
  złamania. Rewers, który nic nie cofa, wygląda w logu jak sukces.

## 5-0ap. ZMIANY update63 (CELA, JENIEC I CIAŁO W WORKU)

Paczka z `projekt-jeniec-cela.md` §2.2–2.4, wszystkie cztery pytania zamknięte
przez gracza. update62 postawił wrogiego dowódcę w drzwiach; ta paczka daje
pokój, w którym może usiąść, i kasę, która za niego płaci.

### Nowy moduł: BRIG (cela)

`SYSTEM_DEFS.brig`, maxLevel **3**, i to jest odpowiedź gracza na pytanie 2:
**jeden jeniec na POZIOM**, nie na moduł. Czyli cela konkuruje o pieniądze na
ulepszenia z tarczą i medbayem, a nie tylko o wolny pokój. Pobiera moc jak
każdy inny moduł. Do kupienia na stacjach z szansą **30 %** — rzadziej niż
reszta, bo to moduł, którego się szuka, kiedy już się zdecydowało grać na
nagrody, a nie taki, na który się wpada na pierwszej stacji.

**Cele liczą się z `workingLevels`, nie z `level`** — rozwalona cela mieści
mniej, zanim zacznie mieścić nikogo. Ale nikt z niej nie znika dlatego, że
pokój się skurczył; to jest osobna rzecz i osobna asercja.

### Jeniec NIE JEST ZAŁOGANTEM

Osobna tablica `ship.prisoners`, nigdy `ship.crew`. Powód jest historyczny i
konkretny: `crew` chodzi przez przydział stanowisk, znoszenie rannych do
medbaya, panel rosteru, głód, sprawdzenie zwycięstwa, dokowanie i barak —
update45 wsadził w tę listę KOTA i gra zaproponowała zwierzęciu konsolę.
Człowiek, który chce cię zabić, jest gorszą rzeczą do wrzucenia w tę listę.
Trzy zasady, jedne drzwi do środka (`takePrisoner`) i jedne na zewnątrz.

### Trzyma ich MOC, nie ściana

Zasilona cela to pokój, w którym siedzą. **Odetnij moc albo rozwal moduł — i
rusza zegar.** Po 40 % czasu leci ostrzeżenie („X is working the cell door"),
po `ESCAPE_SECONDS` (25 s) jeniec **wychodzi śluzą i przepada**.

**Przywrócenie mocy naprawdę ratuje** — zegar wraca do zera, bo człowiek
przerwany przy zamku zaczyna od nowa. Bez tego odcięcie mocy na sekundę byłoby
wyrokiem na nagrodę i gracz nie miałby jak nauczyć się tej zasady z gry.

**Nie walczy** (odpowiedź gracza na pytanie 3). Uciekinier **nie ląduje na
pokładzie jako abordażysta** — nie ma kogo bić, nie ma ciała do wynoszenia,
po prostu nie ma nagrody. Strata JEST karą. Uczciwie: gracz chciał, żeby
biegł do śluzy; robi to poza ekranem. Wersja z chodzącym uciekinierem
wymagałaby dopisania `isPrisoner` do filtrów `isVermin`/`isSpider`/`isBeast` w
kilkunastu miejscach — czyli dokładnie tej klasy błędu, co kot w baraku. Jeżeli
chcesz go widzieć na korytarzu, to osobna paczka i trzeba to zrobić porządnie.

**Odczyt na HUD** pojawia się tylko, kiedy jest cela albo jeniec — stałe `0/0`
na kadłubie bez celi byłoby szumem na każdym przelocie. Ale kiedy moc znika,
napis robi się czerwony i **odlicza sekundy**, bo jedyna rzecz, która nie może
być cicha, to człowiek, który zaraz wyjdzie.

### Jedna cena, dwoje drzwi

`_commanderBounty(cap)` — **jedna liczba**: `40 + ranga*12 + sektor*10`.
Żywy płaci tyle, ciało płaci **połowę tego**, liczoną z tej samej liczby, a nie
wpisaną obok. Dwie ręcznie wpisane ceny za jednego człowieka rozjechałyby się
przy pierwszym balansowaniu i gracz nauczyłby się, że napisom na dwóch
przyciskach nie można ufać względem siebie.

Okno „Their Commander Strikes" ma teraz **trzecie wyjście — „Take him
prisoner"** — pokazywane **tylko, kiedy jest wolna cela**. Przycisk wyszarzony
bez powodu jest gorszy niż przycisk, którego nie ma, więc kiedy celi brakuje,
mówi o tym TEKST okna („You have nowhere to put him").

**Ciało w worku:** `body_bag`, **2×1 kratki** (odpowiedź gracza na pytanie 4:
zapakowane i bezpieczne — nie gnije, nie roznosi plagi, nie ściąga szczurów,
w przeciwieństwie do trupa na pokładzie). Cena jedzie **na worku** (`meta.bounty`),
nie w drugiej tabeli — czyli worek jest wart dokładnie tyle, ile obiecał
przycisk. Jak hold jest pełny, ciało zostaje w kosmosie i gra to mówi.

### Kasa płaci RAZ, przy doku

`Base.returnFromRun` wypłaca za jeńców i za worki **i zdejmuje ich z kadłuba w
tym samym miejscu**. Zostawienie ich na kadłubie i wypłata gdzie indziej
pozwoliłaby oddać tego samego człowieka dwa razy — to kształt każdego błędu
podwójnego liczenia w historii tego pliku. Raport wraca z `bounty`,
`prisoners`, `bodies` i pokazuje je w pasku po zadokowaniu.

### Czego tu NIE MA

* **Ratowania więźniów z wrogich statków** (§2.5) — osobna paczka, dotyka
  baraku, mesy i kolejki załogi.
* **Racji dla jeńca** (§2.3) — czeka na paczkę racji.
* **Listy gończej** — jeniec, który uciekł, powinien na nią wrócić; nie ma
  jeszcze listy.
* Cela **nie ma własnej ikony** — pożycza `icon_medbay`, jak cloak i repair bay
  pożyczają cudze. Do brief-u graficznego.

### Testy

Sekcje **210–213**: poziomy jako cele i odmowa przepełnienia, jeniec **nie w
liście załogi**, rozwalona cela mieści mniej ale nikogo nie gubi; zegar, który
nie rusza pod mocą, ostrzeżenie **dokładnie raz**, ucieczka, **reset zegara po
przywróceniu mocy — i to, że te same dwie sekundy nie wystarczą za drugim
razem**, brak abordażysty i brak ciała po uciekinierze, przejście przez zapis
(z ceną, bez zegara) i stary zapis bez celi; trzecie wyjście tylko przy wolnej
celi + powód w tekście, **cena ciała równa dokładnie połowie ceny żywego
odczytana z NAPISÓW NA PRZYCISKACH**, worek wart człowieka w nim; wypłata
90 + 45, **puste cele i pusty hold po wypłacie, i drugie dokowanie płacące
zero**. Razem **3262 asercje + 79 kroków rysowania + 80 w przeglądarce**.

### Przebiegi łamiące

`break_check.js` ma **147 rewersów** (22 nowe dla update63). Przebiegi:
**145/147 → 147/147.** Dwie luki w pierwszym przejściu, obie to testy
przechodzące z NIEWŁAŚCIWEGO powodu — czyli dokładnie to, po co jest drugie
przejście:
* **okno testu było za krótkie.** Ostrzeżenie o zamku leci po 10 s (40 % z 25),
  a test kręcił 10 sekund — więc ostrzeżenie powtarzane CO KLATKĘ też padłoby
  w nim dokładnie raz. Test musi jechać **daleko za** próg, nie do niego: 15 s.
* **zapis jeńca ze wskazaniem zegara 0.** Test zapisywał człowieka, którego
  zegar i tak stał na zerze, więc asercja „po wczytaniu zegar to 0" przeszłaby
  na loaderze przepisującym pole wprost. Teraz jeniec jest zapisywany **dwie
  sekundy przed ucieczką** i po wczytaniu musi być z powrotem w celi.

## 5-0aq. ZMIANY update62 (NIKT SIĘ NIE PODDAJE RZEŹNIKOWI)

§3.2 pkt 3 projektu karmy: **wróg czyta, kim jesteś, zanim opuści banderę.**
Plus wrogi dowódca przestaje znikać razem ze swoją załogą.

### NAJPIERW SPROSTOWANIE (i lekcja)

W dokumencie `projekt-jeniec-cela.md` napisałem graczowi, że „poddawanie się to
nowy stan walki, nie flaga" i że trzeba go zbudować. **To była nieprawda.**
Mechanizm istnieje od dawna: kadłub ≤30 % → jeden rzut (0,5, nigdy boss) →
okno „They Surrender!" → trybut albo `KILL_HELPLESS −10`. Okno ustawia
`STATE = 'event'`, a `_updateCombat` chodzi tylko w `'combat'` — więc walka jest
zamrożona, kiedy gracz decyduje, i to, czego się bałem (własne działo dobija
jeńca w trakcie okna), **nie może się zdarzyć**.

Gorzej: pisząc tę paczkę dopisałem drugi wyzwalacz poddania („wszyscy załoganci
wybici") do `combat.js` — i **od razu wywalił się test derelicta**, bo gra JUŻ
MA gałąź na tę sytuację (`Derelict Hulk`, „splądruj albo dobij"). Dwa rejestry
na jedno zdarzenie, złapane w pięć minut przez test napisany rok wcześniej.
Drugi wyzwalacz **skasowany**, razem z `enemyCrewStanding()` (kopia istniejącego
`_enemyCrewAliveCount()`) i z `surrenderReason` (rejestr, który po skasowaniu
drugiej drogi miał już tylko jedną wartość).

**Zasada, która to złapała, jest ta sama co zawsze: sprawdź źródło, zanim
zaprojektujesz.** Sprawdziłem — ale dopiero przy pisaniu kodu, nie przy pisaniu
projektu.

### Co jest teraz

**`Commander.surrenderChance(karma)`** — jedna liczba, jedno miejsce:

| karma | szansa, że pobity wróg opuszcza banderę |
|---|---|
| ≤10 | **0 — nigdy** |
| 11–35 | 0,25 |
| 36–79 | **0,5 — dokładnie ta sama moneta, co przed update62** |
| ≥80 | 0,75 |

Zwykły dowódca **nie zauważy żadnej zmiany** — to było celowe. Zmienia się
brzeg skali: rzeźnik nie dostaje ani jednej oferty (dłuższe, droższe walki i
zero trybutu), a przyzwoity dostaje ich połowę więcej.

**Cisza jest bugiem, więc jej nie ma.** Przy karmie ≤10, w momencie w którym
padłaby oferta, leci komunikat: *„They will not surrender to you. They know what
you do to prisoners."* Raz na walkę, nie co klatkę.

**Wrogi dowódca przeżywa swoją załogę.** Gałąź `Derelict Hulk` — ta, która już
odpowiadała na „wybiłeś im wszystkich" — dostała człowieka. Jeżeli wróg ma
dowódcę (`Commander.enemy()`, rekord, nie ciało), okno nazywa się **„Their
Commander Strikes"**, ma jego nazwisko i dwa wyjścia:
* **wejdź na pokład i daruj mu życie** → `+5` karmy, ale **tracisz pewne CC** z
  dobicia — mercy ma cenę, inaczej nie jest decyzją;
* **dobij** → `KILL_HELPLESS −10` i gwarantowane CC.

Bez dowódcy — stary hulk, słowo w słowo, bez karmy po żadnej stronie. Przy
karmie ≤10 dowódca **woli spłonąć** (komunikat z jego nazwiskiem) i gracz
dostaje zwykłego hulka: nie ma czego przyjąć, więc nie ma też za co karać.

### Czego tu NIE MA

**Wzięcia go do niewoli.** Nie ma gdzie go trzymać — to jest paczka celi.
update62 tylko stawia człowieka w drzwiach; cela da pokój, w którym może
usiąść. Odpowiedzi gracza na 4 pytania o celę są w `projekt-jeniec-cela.md` §5:
**jeden jeniec na poziom modułu, uciekinier nie walczy tylko biegnie do śluzy,
ciało zapakowane i bezpieczne, poddanie liczy rannych jako niezdolnych.**

### Testy

Sekcje **207–209**: progi i **monotoniczność** całej skali (skala, na której
bycie lepszym gdzieś w środku daje mniej poddań, jest nie do przeczytania i
żadna pojedyncza asercja by tego nie złapała), ten sam rzut przy dwóch różnych
karmach (bo inaczej progi byłyby dekoracją), **rzut spalony na zawsze** — po
przegranym rzucie nawet `Math.random = 0` już nic nie da, komunikat o braku
łaski dokładnie raz, i cała gałąź wybitych pokładów w czterech wariantach: bez
dowódcy (stary hulk, zero karmy), z dowódcą (nazwisko, dwa wyjścia, karma po
obu stronach), z dowódcą u rzeźnika (hulk + „woli spłonąć"), i jedna oferta na
walkę. Razem **3199 asercji + 79 kroków rysowania + 80 w przeglądarce**.

### Przebiegi łamiące

`break_check.js` ma **125 rewersów** (13 nowych dla update62). Przebiegi:
**124/125 → 125/125.** Luka w pierwszym przejściu: linia o poddaniach w teczce
dowódcy **nie miała żadnego testu** — skasowanie jej niczego nie psuło, a to
jedyne miejsce w grze, gdzie gracz może się dowiedzieć, że jego nazwisko jest
powodem, dla którego nikt nie opuszcza bandery. Dopisane do sekcji 206.

## 5-0ar. ZMIANY update61 (ŚWIAT CZYTA KARMĘ)

Karma miała do tej pory **jednego czytelnika w całej grze** — `Chips.wallColumn`,
czyli pozycję ściany na planszy chipów. Bezwzględny dowódca i święty mieli te
same ceny, tych samych chętnych do służby i te same porty. To jest realizacja
§3.2 z `projekt-karma-dowodcy.md` (wariant B, zatwierdzony przez gracza):
**narzut za niską karmę, nigdy zniżka za wysoką, plus część portów odmawia
obsługi.**

### Progi (jedno miejsce: `KARMA_BANDS` w `commander.js`)

| karma | cena w porcie | etykieta |
|---|---|---|
| 0–20 | **+25 %** | `NOTORIOUS` |
| 21–35 | **+10 %** | `DISTRUSTED` |
| 36–100 | normalna | — (brak) |

`KARMA_SHUNNED = 10` — **na tym poziomie i niżej część portów w ogóle nie
handluje.** Które? `Commander.portRefuses(seed)` liczy to z **własnego ziarna
stacji** (`seed % 3`), nie z losowania przy wejściu. To jest cały sens tej
funkcji: port, który Cię wyprosił, wyprasza Cię też przy następnej wizycie —
inaczej gracz nauczy się, że ponowne dokowanie to automat do gry, i będzie w nie
klikał aż wypadnie. I **nigdy wszystkie** — dowódca z karmą 5, który nie może
kupić paliwa nigdzie, po prostu utknie, czyli kara za reputację zamienia się w
koniec przelotu.

### Kto teraz czyta karmę

1. **Ceny w porcie** — `fuelCost`, `missileCost`, `hullRepairCost`, `he3Cost`,
   `reactorCost`. Narzut jest doliczany **wyłącznie w tych metodach**.
2. **Odmowa obsługi** — `Station.refusal()` zwraca powód albo `null`. Wszystkie
   jedenaście metod `buy*` pytają o to na wejściu.
3. **Rekruci w bazie** — `Base.recruitPrice()` (0,85× / 1× / 1,25× / 1,6×).
   To JEDYNE miejsce, gdzie dobra karma naprawdę płaci: −15 % za człowieka.
4. **Chętni w porcie** — `Commander.recruitInterest()` przesuwa rzut na liczbę
   ludzi szukających koi (−2 / −1 / 0 / +1), a `Station.crewCost()` bierze tę
   samą stawkę co barak.
5. **Teczka dowódcy** — `Commander.karmaWorldLines()`, trzy linie pod karmą.

### Jeden rejestr ceny (skasowane duplikaty)

To była połowa tej paczki i jest ważniejsza niż sama karma. `buyFuel` liczył
`avail * FUEL_PRICE`, a `fuelCost()` liczyło `amt * FUEL_PRICE` — **dwie kopie
tej samej ceny**. Gdyby tylko jedna dowiedziała się o karmie, na półce byłaby
jedna cena, a z konta zeszłaby inna. Skasowane:

* `buyHullRepair`, `buyFuel`, `buyMissiles`, `buyHe3`, `buyReactorUpgrade`
  **pytają teraz metodę wyceny**, zamiast mnożyć po raz drugi;
* `stock.crew[].cost` (zapisane 60 CC na rekordzie) **usunięte** — stawka jest
  odpytywana na żywo przez `Station.crewCost()`;
* przycisk naprawy kadłuba w `ui.js` woła `s.hullRepairCost(n)` zamiast
  `n * s.hullRepairCost()` — to samo dotyczyło zaokrągleń He-3 (stary test
  liczył `3 * he3Cost()` i po zmianie **wypadł**; to była prawdziwa rozbieżność
  1 CC, nie usterka testu);
* `basescreen.js` czyta `Base.recruitPrice()` zamiast `Base.PRICE.recruit`, więc
  napis na przycisku i kwota pobrana z konta nie mogą się rozjechać.

`PRICE.recruit` i `FUEL_PRICE`/`MISSILE_PRICE`/`REPAIR_PRICES` **zostają jako
jedyne zapisane liczby bazowe** — karma jest doliczana nad nimi w jednym miejscu.

### Widoczny powód (to nie jest kosmetyka)

Zamknięty dok **zastępuje całe okno sklepu** czerwonym banerem
`DOCK CLOSED — <nazwa> will not trade with you.` i zostawia tylko `DEPART`.
Pusty sklep bez wyjaśnienia gracz przeczyta jako buga — spec mówi to wprost.
Narzut jest łagodniejszy: baner pomarańczowy, sklep otwarty.

### Czego tu NIE MA (świadomie)

* **Ceny broni i modułów zostają bez narzutu.** Ich koszt siedzi na rekordzie
  stanu (`item.cost`) i mnożenie go przy generowaniu zamroziłoby karmę z
  momentu wejścia. Narzut obejmuje usługi doku: paliwo, rakiety, poszycie,
  rudę, reaktor i ludzi.
* **Poddawanie się wroga** (§3.2 pkt 3) — osobna paczka, decyzja gracza.
* **Kontrakty za progiem karmy** (§3.2 pkt 4) — do zrobienia, w §6.
* **Naprawa uczciwego skraju** (§3.3) — gracz zdecydował ZOSTAWIĆ jak jest:
  „na 1 lev blokuje jedyny wolny kwadrat na cpu to zostawiamy, jest ok".

### Testy

Nowe sekcje **202–206**: progi i brak zniżki na całej skali 36–100, karma poza
zakresem i rekord bez karmy (żadnego NaN w cenie), narzut na czterech towarach,
**kwota pobrana = kwota z wyceny**, determinizm odmowy (ta sama trzecia część
portów przy każdym wejściu), nigdy wszystkie porty, zamknięty dok odmawia na
pięciu kasach z tym samym powodem i nie rusza ani jednego CC, cena rekruta na
przycisku i w kasie, liczba chętnych rosnąca z karmą, i teczka dowódcy czytana
z narysowanego tekstu, nie z helpera.

W przeglądarce nowa **SESJA 5** — sklep to DOM, więc baner i zamknięty dok da
się sprawdzić tylko tam: brak banera przy zwykłej karmie, baner z figurą przy
`DISTRUSTED`, napis na przycisku naprawy **równy wycenie stacji**, zamknięty dok
bez zakładek i bez treści, ale z `DEPART`, i ten sam dowódca w porcie obok, który
jednak handluje. Ziarna portów są w tym teście **wyliczane z reguły gry**, nie
wpisane na sztywno.

Razem **3159 asercji + 79 kroków rysowania + 80 w przeglądarce**.

### Przebiegi łamiące

`break_check.js` ma **112 rewersów** (21 nowych dla update61). Przebiegi:
**108/109 → 111/112 → 112/112.** Luka w pierwszym przejściu: jeden rewers miał kotwicę
przepisaną z pamięci, nie skopiowaną z pliku (`karmaNow` jest w źródle w trzech
liniach, nie w jednej) — skrypt zgłosił `ANCHOR MISSING` i miał rację. To jest
dokładnie ta klasa błędu, dla której drugie przejście jest obowiązkowe:
**rewers, który niczego nie cofa, wygląda w logu jak sukces.**

Prawdziwa luka wyszła dopiero w DRUGIM przejściu, po naprawieniu kotwicy:
**skasowanie clampa karmy niczego nie psuło.** `band()` miało `|| ostatni pas`,
więc karma 999 z clampem i bez niego dawała ten sam wynik — test przechodził z
NIEWŁAŚCIWEGO powodu, a clamp był kodem, którego nie dało się złamać.
Naprawione przez **skasowanie**, nie przez dopisanie: fallback z `band()`
usunięty (ostatni pas i tak sięga 100, więc był martwy), przez co clamp stał
się jedynym zabezpieczeniem — i teraz jego usunięcie naprawdę wywraca cenę.
Trzecie przejście: 112/112.

## 5-0as. ZMIANY update60 (DZIAŁO PAMIĘTA SWOJĄ KOMORĘ)

Spłacony dług wypisany na końcu update59. Nie ma tu żadnej nowej mechaniki —
jest skasowanie sposobu, w jaki działo mogło po cichu zacząć czerpać moc i
obsadę z cudzego modułu.

### Co było źle
`weaponRooms` to `rooms.filter(r => r.type === 'weapons')` — lista budowana OD
NOWA przy każdym odczycie. Działo znajdowało swój moduł przez POZYCJĘ w tej
liście (`weaponRooms[slot]`), więc nic nie kotwiczyło działa do miejsca:
parowanie było przypadkiem kolejności pokoi. Wystarczyłby układ, w którym pusty
pokój stoi PRZED komorą broni — po dostawieniu tam modułu każde działo na
statku zaczyna czytać cudzą moc i cudzą obsadę.

Żaden dzisiejszy kadłub tego nie robi (sprawdzone na wszystkich trzech i
przybite asercją, żeby sekcja dalej coś znaczyła). Dokładnie dlatego to jest
pułapka warta zamknięcia teraz: odpala się na pierwszym układzie, który ktoś
kiedyś doda, i objawia się jako „działo przestało działać bez powodu" — czyli
tak samo jak bug, który kosztował gracza przelot w update59.

### Co jest teraz
**Broń ma `roomId`** — komorę, w którą jest wkręcona. `Ship.weaponRoomFor(w)`
jest jedynym miejscem, które odpowiada na pytanie „gdzie to działo siedzi", i
czytają je: rozdział mocy, obsada w pętli statku, premia strzelca, obie ścieżki
w `combat.js`. `slot` to nadal miejsce w TABLICY broni; `roomId` to moduł. Dwa
różne pytania, dwie różne odpowiedzi — przedtem jedno pytanie odpowiadane
pozycją.

**Zapis niesie `roomId`**, a stary zapis (bez niego) dostaje przy wczytaniu
pozycyjny — czyli dokładnie to, co ten zapis znaczył, kiedy powstawał.

**Fallback pozycyjny ZOSTAJE** dla kadłubów bossów, które montują więcej dział
niż mają komór; działo bez własnego pokoju uczciwie odpowiada `null` i dostaje
moc ze wspólnej puli, tak jak dotąd.

### Testy
Nowa sekcja **201**: pułapka zbudowana ręcznie (pokój przestawiony na przód
tablicy, komora dostawiona przed istniejącą) i sprawdzenie, że działo dalej
trzyma się swojej — z mocą i z obsadą, nie tylko z id. Do tego pełny obieg przez
zapis, stary zapis bez `roomId`, **zapis, w którym komora NIE ZGADZA SIĘ z
pozycją** (refit na stacji) i przypadek nadmiarowego działa bez komory.
Razem **3103 asercje + 79 kroków rysowania + 66 w przeglądarce**.

`break_check.js` ma **88 rewersów**. Przebiegi: **87/89 → 88/88 → 88/88.**
Dwie luki w pierwszym przejściu, obie znajome:
* jeden rewers dodawał tylko martwą, nieużywaną metodę — **nie cofał niczego**.
  Skrypt zgłosił lukę i miał rację; skasowany, bo prawdziwy rewers tej poprawki
  siedzi w następnej pozycji;
* test wczytywania przechodził, bo we WSZYSTKICH jego przypadkach zapisana
  komora i pozycyjna wskazywały ten sam pokój — więc nie zauważyłby loadera
  wyrzucającego zapisaną wartość. Doszedł kadłub, w którym te dwie odpowiedzi
  się różnią.

## 5-0at. ZMIANY update59 (DZIAŁO, KTÓRE NIE STRZELA, MÓWI DLACZEGO)

### Co się stało graczowi
Przed bossem dołożył moduł broni, podniósł go na poziom 3, wstawił **Hull
Cannon**, przestawił załogę. Po kilku strzałach działo przestało strzelać —
naładowane, zasilane, obsadzone. Zaznaczał je, klikał w moduł wroga i **nic się
nie działo**. Nie działało też w następnej walce. Zginął.

### Przyczyna: Hull Cannon zjada rakietę na strzał, a odmowa była CAŁKOWICIE CICHA
`cannon_basic` ma `missileUse: 1`. W `playerFire` stało:

```js
if (hold.countOf('missiles') < weapon.def.missileUse) return;
```

Bez komunikatu, bez znaku na karcie działa, bez niczego. Kiedy stelaże się
opróżniły, działo dalej wyglądało na gotowe — naładowane, zasilane, z obsadą — a
rozkaz ognia po prostu znikał. Na zawsze, bo nic nie powiedziało, że problem to
amunicja. Gracz stracił przez to przelot.

**To jest ta sama reguła, którą przyjęliśmy w update53 przy rozkazach
specjalnych: akcja, która odmawia, musi powiedzieć, czego brakuje.** Wtedy
dotyczyła ośmiu rozkazów; przez cały ten czas najczęściej używana akcja w grze —
strzał — łamała ją w ciszy.

### Poprawka
**`CombatManager.fireRefusal(weapon)`** — JEDNA implementacja pytania „czy to
działo może teraz strzelić", zwracająca powód albo `null`. Czyta ją troje:
`playerFire` odmawia nim, game.js go MÓWI, a karta działa się nim znaczy. Nie da
się już rozjechać komunikatu z zachowaniem, bo to jedno zdanie.

Zamknięte trzy ciche ścieżki:
1. **klik w moduł wroga** przy pustych stelażach — teraz komunikat z nazwą działa
   i liczbą brakujących rakiet;
2. **naciśnięcie numeru działa**, którego nie da się zaznaczyć (ładuje się albo
   straciło zasilanie) — wcześniej nie działo się absolutnie nic, ten sam martwy
   klik o krok wcześniej. To jest przypadek działa, którego poziom‑3 komora
   została rozbita do dwóch mocy: `powered` wymaga PEŁNEGO `powerCost`, a Hull
   Cannon bierze 3;
3. **AUTO‑ogień**, który odmawiał sześćdziesiąt razy na sekundę — mówi raz na
   działo, dopóki powód się nie zmieni, żeby pusty stelaż nie zasypał logu.

**Karta działa pokazuje `NO AMMO!`** na pomarańczowo, obok istniejącego
`NO CREW!`. Stan należy do działa i ma być widoczny ZANIM gracz kliknie.

**Czego świadomie NIE dodałem:** pustej obsady jako powodu odmowy. Pusta komora
zamraża ŁADOWANIE, ale pocisk już w komorze wylatuje — dopisanie tego byłoby
wymyśleniem reguły, której silnik nie ma. Sekcja 200 sprawdza, że nie ma.

### Uwaga na przyszłość, znaleziona przy okazji
`weaponRooms` to `rooms.filter(type === 'weapons')`, a działo jest sparowane z
modułem **przez POZYCJĘ w tej liście**. Żaden dzisiejszy kadłub nie ma pustego
pokoju PRZED komorą broni, więc dołożenie modułu nie przestawia par — sprawdziłem
na wszystkich trzech. Ale to jest pułapka czekająca na pierwszy układ, w którym
tak będzie: wtedy działo po cichu zacznie czerpać moc i obsadę z cudzego modułu.
Właściwa naprawa to związanie działa z `roomId`, a nie z indeksem. **Nie zrobione
w tej paczce** — nie chciałem przebudowywać parowania przy okazji naprawy
amunicji.

### Testy
Nowa sekcja **200**: odmowa nazywa działo i brak, dwa różne powody nie mylą się ze
sobą, ładunek nie jest tracony przy odmowie, karta znakowana i odznaczana,
działo bez amunicji nigdy nie znakowane, oraz **prawdziwa ścieżka kliknięcia** i
prawdziwe naciśnięcie numeru. Razem **3080 asercji + 79 kroków rysowania + 66 w
przeglądarce**.

`break_check.js` ma **82 rewersy**. Przebiegi: **79/81 → 82/82 → 82/82.** Obie
luki z pierwszego przejścia znowu tej samej rodziny:
* test sprawdzał `playerFire` bezpośrednio, więc dowodził REGUŁY, a nie
  OKABLOWANIA — a okablowanie było całą skargą gracza. Doszedł test jadący przez
  prawdziwy klik;
* jeden rewers (`true &&`) niczego nie zmieniał, bo działo bez amunicji i tak nie
  przechodzi wewnętrznego testu. Przecelowany na „naładowane działo nadal pisze
  NO AMMO", co sekcja łapie.

## 5-0au. ZMIANY update58 (He-3 WIDOCZNY, KSIĘŻYCE DO ODKRYCIA)

Dwie rzeczy, obie z tego samego zarzutu: update56 dodał He-3 i regiony, ale
**nie dało się ich zobaczyć w grze**. Rzecz, której gracz nie widzi, w praktyce
nie istnieje.

### 1. Ruda jest na ekranie
Nowy odczyt **`He3 n`** z własnym piktogramem (`STAT_ICONS.ore` — kanciasty
kryształ, nie kanister i nie skrzynia) na pasku zasobów w locie, obok CC, He2 i
rakiet, oraz w tej samej linii na ekranie mapy, bo tam się decyduje, czy nadłożyć
drogi po złom. Pasek poszerzony z 320 na 390 px.

Liczba czytana **PROSTO Z ŁADOWNI** (`cargo.countOfTag('he3')`) — komórki SĄ
ilością, dokładnie tak jak cele He2 i stelaże rakiet, więc nie ma drugiego
licznika, który mógłby się rozjechać. Rysowany przygaszony przy zerze, a nie
chowany: odczyt, który raz jest a raz go nie ma, to odczyt, którego gracz nigdy
nie nauczy się szukać.

### 2. Widać, że jesteśmy na Księżycu — i co jest dalej
Zamknięte drzwi, za którymi nic nie ma, to nie obietnica, tylko ściana. Tabela
`Save.REGIONS` ma teraz **siedem księżyców**: Luna (otwarta) plus Europa, Io,
Ganimedes, Tytan, Enceladus i Tryton — każdy z ciałem macierzystym i jedną linią
o tym, po co ktokolwiek miałby tam lecieć. Wszystkie `locked: true`.

* **Zakładka GATE** dostała listę **DESTINATIONS**: Luna z kropką „open",
  reszta pusta z „locked · Jupiter/Saturn/Neptune".
* **Wybór kontraktu** ma nagłówek `LUNA · CONTRACTS — more moons open with the
  Moon Gate`. Trzy zlecenia bez adresu czytają się jako „to jest cała gra"; te
  same trzy pod nazwą księżyca czytają się jako „to jeden księżyc z kilku".

**Blokada jest w ZAPISIE, nie w tabeli.** `Save.regionUnlocked(key)` pyta
`unlockedRegions` — listę, która istnieje od update56 — więc w dniu, w którym
Brama naprawdę coś otworzy, zmienia się jedna lista i nic poza nią.

### Testy
Nowe sekcje **198–199**. Razem **3057 asercji + 79 kroków rysowania + 66 w
przeglądarce**. `break_check.js` ma **74 rewersy**, przebiegi **72/74 → 74/74 →
74/74**. Obie luki z pierwszego przejścia to znowu testy przechodzące z
niewłaściwego powodu, i obie warto zapamiętać:

* test piktogramu szukał `drawStatIcon(ctx, 'ore'` **w źródle** — i przechodził
  z ikoną skasowaną z HUD-u, bo ekran mapy ma drugie takie wywołanie i plik
  nadal je zawierał. Teraz test **czyta płótno**: przechwytuje `fill()` podczas
  rysowania HUD-u i szuka koloru rudy na wypełnionej ścieżce, czego sam tekst
  (idący przez `fillText`) nie wytworzy;
* test tabeli księżyców sprawdzał ETYKIETY, więc księżyc z rozwalonym KLUCZEM
  przechodził — a klucz jest tym, co trzyma zapis (`run.region`,
  `unlockedRegions`). Sprawdza teraz klucze.

## 5-0av. ZMIANY update57 (ZAŁOGA NIE ZMIENIA KORPORACJI, CONTINUE W BAZIE)

### 1. Nikt nie zmieniał korporacji i nikt nie znikał — LISTA SIĘ PRZESTAWIAŁA
Zgłoszenie brzmiało „nieraz zaloganci zmieniają korporację, albo znikają i
pojawiają się inni". Odtworzone i sprawdzone: **wszyscy wracają, z tym samym
`id`, imieniem i korporacją**. Rusza się KOLEJNOŚĆ.

Kto leci, jest przy starcie WYCINANY z `barracks`, a przy dokowaniu
**dopychany na KONIEC** listy. Karty w zakładce CREW rysują się w kolejności
tablicy, każda z kolorem korporacji — więc po każdym kontrakcie trójka, która
leciała, ląduje na dole, dwójka, która została, wjeżdża na górę, i te same pięć
osób czyta się jako inne osoby.

`joined` to bilet pobierany RAZ, przy pierwszym wejściu do koszar, i nigdy
przeliczany. `Base.crew()` sortuje po nim. Bilet jedzie z człowiekiem na
kontrakt (jest w `serialise`, dokładnie z tego samego powodu co `id`) i wraca z
nim, więc lot nie przesuwa nikogo na liście. Stary zapis dostaje bilety przy
pierwszym odczycie, w kolejności, w jakiej już leży — istniejąca baza nie
przetasuje się w dniu wgrania paczki.

**Przebieg łamania znalazł tu prawdziwy błąd w mojej własnej poprawce:**
pierwsza wersja `_stampJoined` numerowała JEDNYM przebiegiem, więc w bazie
częściowo już ponumerowanej dwóch ludzi dostawało ten sam bilet i sortowanie
między nimi znowu zależało od kolejności tablicy. Teraz są dwa przebiegi:
najpierw najwyższy istniejący numer, potem wydawanie powyżej niego.

**Uwaga na resztę zgłoszenia:** jeśli wystartujesz z ZEROWĄ zaznaczoną załogą,
gildia wysyła trzech losowych zielonych (`makeStartingCrew` w `_startContract`) i
oni po powrocie trafiają do koszar. To działa tak celowo od dawna i jest
zapowiedziane komunikatem przy starcie — ale w połączeniu z przestawianiem listy
mogło wyglądać jak „pojawili się obcy ludzie".

### 2. CONTINUE zeszło z menu do bazy
Ekran tytułowy kazał wybierać między „wejdź do bazy" a „kontynuuj kontrakt",
zanim gracz mógł zobaczyć stan któregokolwiek — a kontrakt w powietrzu jest
faktem O BAZIE: hangar jest o kadłub uboższy, a koszary o załogę, dopóki nie
wróci. Menu ma teraz dwa wejścia (`ENTER BASE`, `SETTINGS`), a CONTINUE stoi w
pasku startowym w bazie i **pokazuje się tylko wtedy, gdy jest do czego wracać**.

`MENU_ITEMS` i przyciski rysowane przez renderer muszą mieć tę samą DŁUGOŚĆ —
game.js rozdziela kliknięcia po INDEKSIE. Sekcja 196 czyta jedno i drugie i
pilnuje tego.

### 3. Start nowego kontraktu nad żywym to spisanie statku na straty — i pyta
Kadłub, wszyscy na pokładzie i cała ładownia przepadają w chwili, gdy wylatuje
następny; baza nie umie odwołać statku. To druga nieodwracalna akcja w tym
ekranie, więc pyta — tym samym modalem co SELL. Przycisk **ostrzega też na
swojej twarzy** („a contract is still out there"), bo okno po fakcie jest lepsze
niż nic, ale ostrzeżenie należy do przycisku.

**Nowy predykat `Save.hasShipInFlight()`.** `hasActiveRun()` jest prawdziwe w
chwili, gdy istnieje pusty rekord przelotu — pytanie, które baza musi zadać,
jest węższe: czy kadłub został wypożyczony z hangaru i nie wrócił. Znacznikiem
jest `run.shipKey`, pisany wyłącznie przez `_startContract`. Za luźny predykat
pyta „czy na pewno" przed pierwszym lotem w sesji; za ciasny spisuje statek w
ciszy.

### Testy
Nowe sekcje **195–197**: kolejność koszar przez pełny obieg kontraktu (z
biletami, starym zapisem i kolizją biletów), CONTINUE po obu stronach, okno
przy starcie nad żywym kontraktem. Razem **3033 asercje + 79 kroków rysowania +
66 w przeglądarce**.

`break_check.js` rozszerzony do **66 rewersów**, wszystkie łapane. Przebiegi:
**63/63 → 63/63 → 65/67 → 65/66 → 66/66.** Trzecie przejście (po dołożeniu
subtelniejszych rewersów) było tym, które się opłaciło:

* rewers **kolizji biletów** przechodził, bo mój test numerował istniejące
  rekordy liczbami 50, 51, 52 — poza zasięgiem licznika startującego od zera, więc
  kolizja nie mogła zajść. Po poprawieniu testu **wywalił się kod, nie test**, i
  tak wyszła dwuprzebiegowa wersja `_stampJoined`;
* jeden rewers miał anchor, który nie pasował do niczego (`ANCHOR MISSING`).
  Skasowany, nie przycelowany: CANCEL idzie przez JEDEN `confirmNo`, a rewers na
  niego już wyżej istnieje.

**Uwaga o samym skrypcie:** `break_check.js` przywraca pliki w `finally`, ale
zabicie procesu w trakcie (timeout) zostawia jeden plik zepsuty. Jeśli po
przerwanym przebiegu testy padają, sprawdź `git diff` — to nie jest regresja,
tylko niedokończone sprzątanie.

## 5-0aw. ZMIANY update56 (He-3, MOON GATE, REGIONY)

Pierwsza paczka „przygotowawcza": wszystko poniżej ma w demie być WIDOCZNE i
w większości NIECZYNNE. Chodzi o zajęcie miejsca w kodzie, dopóki jest tanio.

### 1. He-3 jako minerał — i to NIE jest paliwo
`CARGO_ITEMS.he3_ore`, `kind: 'trade'`, `tag: 'he3'`, stos do 10, wartość 30 CC.
Rozróżnienie jest ważniejsze, niż wygląda: statek lata na **He2**
(`kind: 'fuel'`, liczone przez `Ship.fuelCount()`, palone przy każdym skoku).
He-3 to surowiec — wydobywa się, wozi, kupuje i sprzedaje, i **w demie nie robi
nic więcej**. Gdyby dostał `kind: 'fuel'`, licznik paliwa zacząłby go zliczać i
mielibyśmy dwie różne substancje pod jedną liczbą — dokładnie tę awarię, którą
ten projekt raz po raz kasuje.

Źródła: wraki (waga `2 + sektor/2` w `cargoRollTable`) i **sklep na stacji**
(`Station.buyHe3`, cena `he3Cost()` rosnąca z sektorem). Zakup ma ten sam
kształt co `buyFuel` — najpierw próba na KOPII ładowni, więc gracz nigdy nie
płaci za rudę, która się nie mieści.

**Nowe: `CargoGrid.countOfTag(tag)`.** `countOf` odpowiada po RODZAJU, co jest w
sam raz dla paliwa i rakiet; He-3 jest `trade` jak tuzin innych rzeczy, więc
liczenie go idzie po tagu. Lista części Bramy czyta półkę tak samo — dlatego to
siedzi na siatce, a nie w żadnym z wywołujących.

### 2. Moon Gate — miejsce, nie mechanika
Ósma zakładka w bazie: **GATE**. Schemat pierścienia po lewej (łuk zapełnia się
ułamkiem ukończenia), lista części po prawej — liczona **z prawdziwego magazynu
bazy**, jednej jedynej półki, której używa cała reszta gry. Zero drugiego
inwentarza na komponenty Bramy.

**I zero przycisku BUILD.** Przycisk, który odmawia, jest gorszy niż jego brak —
ta sama reguła, która skasowała nieosiągalną gałąź w update53. Zamiast niego
jedna linijka: konstrukcja niedostępna w tej wersji, zachowaj części.
Wszystko rysowane w szarościach, bo to nie jest rzecz, na którą można działać.

Części (`GATE_PARTS`): He-3 ×40, Unstable Core ×2, Module Crate ×4, Hull Plating
×12, Drone Core ×3. Wszystkie to ZWYKŁY ładunek, który już w grze jest.

### 3. Regiony — jedno pole, póki kosztuje jedno pole
Mapa nie miała pojęcia, GDZIE jest. Trzy kontrakty istniały bez adresu — co było
w porządku, dopóki jest jedno miejsce do latania, i oznaczałoby migrację
wszystkich zapisów w dniu, w którym pojawi się drugi księżyc.

`Save.REGIONS` (na razie sama `luna`), `run.region`, `unlockedRegions` w zapisie,
migracja przy wczytaniu (brak regionu → `luna`, dokładnie jak `captain` →
`commander` w update52). Na ekranie mapy tytuł brzmi teraz **`LUNA · SECTOR n
MAP`** — gracz, który to czyta, wie, że jest gdzieś konkretnie i że są inne
miejsca. Po to jest Brama.

### 4. Przy okazji: wracający kadłub zawsze ma miejsce
`Base.storeShip` stosował limit hangaru także do kadłuba, który był z tego
hangaru **WYPOŻYCZONY** przy starcie — więc gracz, który dokupił statek, gdy
pierwszy był w trasie, wracał do pełnego hangaru i **tracił statek, którym
leciał**, z jedną linijką notki jako jedynym śladem. Limit dotyczy teraz tylko
KUPOWANIA; powrotu nie da się odmówić.

### Testy
Nowe sekcje **190–194**: He-3 nie jest paliwem (i He2 w tej samej ładowni nadal
jest), handel rudą na stacji, regiony z migracją, Brama bez przycisku, wracający
kadłub. Razem **2995 asercji + 79 kroków rysowania + 66 w przeglądarce**.

`break_check.js` rozszerzony do **54 rewersów**. Przebiegi: **51/54 → 54/54 →
54/54**. Trzy luki w pierwszym przejściu i wszystkie warte zapamiętania:

* test migracji zapisu pisał pod **złym kluczem** (`moonwars_save` zamiast
  `moonwars_save_v1`), więc `load()` odczytywał ORYGINALNY rekord i asercja
  przechodziła, choć migracja nigdy się nie wykonała. Teraz test najpierw
  DOWODZI, że podrasowany zapis jest tym, co zostanie wczytane;
* test sklepu wstawiał rudę ręcznie, więc nie zauważyłby generatora, który nigdy
  jej nie losuje — doszło sprawdzenie dwunastu portów;
* jeden rewers był **samym komentarzem** i niczego nie cofał. Skrypt zgłosił go
  jako lukę i miał rację: rewers, który nic nie psuje, jest gorszy niż jego brak.

## 5-0ax. ZMIANY update55 (DRUGA TURA POPRAWEK Z TESTÓW NA ŻYWO)

Osiem pozycji z listy gracza po update54. Jedna została NIEODTWORZONA — patrz na
końcu, to jest uczciwie zapisane, a nie po cichu zamiecione.

### 1. Ich abordaż w próżni to nadal ich załoga
To była ta sama pomyłka co w update54, tylko w drugim miejscu. `_makeParty`
ZDEJMUJE ludzi z listy załogi statku, z którego wychodzą, i dopisuje ich dopiero
przy wejściu na cel — więc kiedy wróg wysyłał wszystkich, jego pokład na kilka
sekund czytał się jako PUSTY. Wtedy odpalało się okno **DERELICT HULK** („ich
załoga wybita, statek dryfuje") i bitwa się kończyła, podczas gdy przez przestrzeń
leciała do nas ekipa z siekierami.

`_enemyCrewAliveCount()` jest lustrzanym odbiciem istniejącego
`_playerCrewAliveCount()`: patrzy w TRZY miejsca — ich pokład, próżnia, nasz
pokład. `CombatManager.intrudersAboard()` też liczy teraz próżnię, przez licznik,
który game.js wstawia mu przy ładowaniu (parties należą do game.js, nie do
CombatManagera).

**Uwaga na drugie pytanie, które wygląda tak samo:** „czy gniazdo jest
wyczyszczone" (tryb wraku) liczy WSZYSTKO wrogie na kadłubie, pająki włącznie, i
pyta tylko o sam wrak — bo wrak nie wysyła abordażu. To są dwa różne pytania i
mają dwie różne odpowiedzi; zlanie ich w jedno wywaliło sekcję 6037.

### 2. TAB chodzi po liście załogi
Pierwsze naciśnięcie bierze człowieka z GÓRY listy, każde następne schodzi o
jeden i zawija na dole. Chodzi po `Renderer.crewRoster` — dokładnie tej liście,
która jest narysowana przy lewej krawędzi — więc podświetlenie wędruje tak, jak
wodzi wzrok gracza, i ekipa abordażowa na dole panelu też jest osiągalna.
Tylko NASI i tylko na nogach: martwe nazwisko to nazwisko, któremu nie wydasz
rozkazu. Zaznaczenie jest ZASTĘPOWANE, nigdy dokładane — TAB odpowiada na „kim
teraz dowodzę", a grupy buduje się shift-klikiem. Na mapie TAB dalej przełącza
widok mapa/statek, bo to inny ekran.

### 3. Drzwi: otwartego włazu się nie hakuje, a ich dowódca go zamyka
Abordaż spędzał pełne cztery sekundy na cięciu zamka, który stał otwarty — hak
był bezwarunkowy. Teraz otwarty właz się po prostu przechodzi. **I dlatego rozkaz
wrogiego dowódcy ma sens:** kiedy gracz startuje z abordażem, dowódca po drugiej
stronie robi to, co gracz zrobiłby tym samym przyciskiem — **zamyka cały statek**.
Kosztuje nas to te cztery sekundy przy zamku, więc wróg Z dowódcą jest mierzalnie
trudniejszy do wzięcia niż wróg bez — i o to w nich chodzi. Raz na abordaż.

### 4. Wrogowie mają korporacje, które widać, i fach, który liczy
Dwie osobne rzeczy pod jednym objawem „wszyscy są czerwonymi Phoenixami":

* **Widać.** `ENEMY_CORP_MIX` losował mieszankę od dawna, ale `suitColor()`
  malował KAŻDEGO wroga jednym płaskim czerwonym. Cała różnorodność była w
  danych i żadna z niej nie docierała do ekranu. Teraz skafander niesie
  KORPORACJĘ, a STRONĘ niesie **czerwony pierścień** rysowany wokół każdego
  żywego wroga (`drawSideRing`). Pierścień czyta się od razu i nie kłóci się z
  korporacją, która akurat jest pomarańczowa.
* **Liczy się.** Każdy wrogi zalogant dostawał dwie umiejętności na poziomie 1 —
  w sektorze 1 i w sektorze 8 tak samo — podczas gdy nasi wspinali się na 3/3 i
  moduły im za to płaciły. Te same akcesory obsługują obie strony
  (`consoleOperator`, `weaponCrewBonusFor`, `evasion`), więc brakowało wyłącznie
  tego, żeby drugiej stronie cokolwiek w nie włożyć. Teraz: sektor 1–2 dwie
  umiejętności na 1, sektor 3–4 trzy z jedną na 2, sektor 5+ trzy na 2 z jedną
  opanowaną na 3. Imiona na jednym kadłubie się nie powtarzają.

### 5. Terra ma 80 HP
Cztery kwadraciki zamiast pięciu. Cyborg, który obsadza moduł na samym implancie,
był najmocniejszą korporacją w grze bez żadnej ceny; teraz cena jest widoczna —
odkąd odczyty są kwadracikami, brak jednego pola widać, a liczby nikt nie czyta.
Liczba siedzi w `CORP_DEFS` obok bonusów XP i flagi cyborga (jedna tabela), a
jawne `cfg.maxHp` nadal wygrywa, żeby stary zapis wczytał człowieka takim, jaki
był.

### 6. Kwadraciki także w bazie, RENAME zszedł z danych
update54 dał kwadraciki statkowi i zostawił koszary na pasku — ten sam człowiek
czytał się inaczej zależnie od ekranu. Jeden `Renderer.drawPips` na obu.
Przycisk RENAME wędrował dwa razy: karta nie ma wolnego rogu (umiejętności idą w
TRZECH kolumnach od x+190 i sięgają x+357 przy karcie szerokiej na 364), więc
usiadł w prawym dolnym rogu, pod ostatnią kolumną kwadracików. Sekcja 189 czyta
z jednego rysowania prostokąt przycisku, kwadraciki I każdą linię tekstu i wywala
się, jeśli cokolwiek podejdzie bliżej niż cztery piksele — bo ramka pikselę od
kwadracików czyta się jak nałożona, i **pierwsza wersja tej asercji przeszła
dokładnie na takim układzie.**

### NIE ODTWORZONE: moduł medyka niewidoczny w hangarze
Gracz zgłosił, że zamontowany medyk nie pokazał się w hangarze i pojawił się
dopiero po dwóch wyprawach. **Nie udało mi się tego wywołać.** Sprawdzone:
`addModule` zapisuje `_extraModules`, `serialise()` je wynosi, `deserialise()`
odtwarza, `BaseScreen._levels` pokazuje, i pełny obieg `Base.launch()` →
`returnFromRun()` → hangar też pokazuje — na scoutcie i na haulerze.
Jedyne, co po drodze wyszło: `addModule` ODMAWIA, gdy kadłub już ma moduł tego
typu (Horus ma medyka fabrycznie), a `Base.storeShip` odmawia przy pełnym
hangarze i wtedy wracający kadłub przepada — to drugie zostało do obgadania.
**Potrzebne od gracza:** który kadłub, gdzie kupiony moduł (stacja czy baza) i
czy hangar był pełny.

### Testy
Nowe sekcje **184–189**: abordaż w próżni, TAB po liście, otwarty właz i rozkaz
wrogiego dowódcy, skalowanie wrogich załóg, Terra na 80 HP, karta w koszarach.
Razem **2951 asercji + 79 kroków rysowania + 66 w przeglądarce**.

`tests/break_check.js` rozszerzony do **41 rewersów**. Przebiegi: **38/41 →
41/41 → 41/41**. Trzy luki w pierwszym przejściu, wszystkie pouczające:
jeden anchor zdezaktualizował się razem z poprawianym kodem (skrypt to zgłasza
osobno, `ANCHOR MISSING` — i to jest sygnał, że rewers przestał czegokolwiek
pilnować), a dwa testy sprawdzały ISTNIENIE zamiast UŻYCIA: pierścień był
testowany przez bezpośrednie wywołanie `drawSideRing`, więc skasowanie wywołania
w `draw()` przechodziło; a kolizja przycisku była zwykłym przecięciem
prostokątów, więc układ „piksel obok" przechodził. Oba mierzą teraz to, co widzi
gracz.

## 5-0ay. ZMIANY update54 (15 POPRAWEK Z TESTÓW GRACZA NA ŻYWO)

Lista gracza po pierwszym prawdziwym przelocie z update53. Piętnaście pozycji,
jedna paczka. Kolejność niżej jest kolejnością z jego listy.

### 1. Karma bez dowódcy nie obiecuje niczego
Sama karma była poprawna: `_resolveEvent` (game.js) przesuwa ją tylko, gdy jest
dowódca. Kłamało UI — okno wyboru malowało przyciski na zielono i czerwono i
dopisywało `+5 KARMA` niezależnie od tego, czy ktoś siedzi w fotelu. Teraz
`_hasCommander()` decyduje o obu: **jedno pytanie, jedna odpowiedź.**

### 2. Powietrze ucieka, kiedy nikt go nie robi
`OXYGEN.BREATHING` 0,014 → **0,04**/s: martwy moduł O2 dawał 71 sekund pełnego
powietrza, dłużej niż większość walk. Teraz opróżnia pokój w ~25 s.
`DRAIN_BREACH` 0,07 → **0,16**/s — dziura w kadłubie robi to w 7 s zamiast 14.
`REFILL_PER_POWER` 0,03 → **0,06**, żeby najstarsza obietnica tego pliku
(wrak na jednym kwadracie mocy trzyma powietrze, sekcja 94) dalej była prawdą.
Trzy liczby w JEDNEJ tabeli, żadnego drugiego drenażu obok.

### 3. Czerwona plama na uszkodzonym module — skasowana
`ShipSystem.draw` zalewał do połowy pokoju czerwienią, zabijając podłogę,
sprite'y załogi i warstwę tlenu pod spodem — i mówił to, co gra mówi już trzema
innymi kanałami (czerwone kwadraciki mocy, dym, wygaszona ramka). **Czwarta
kopia jednego faktu, i najgłośniejsza.** Usunięta, nie przygaszona: słabsza
wersja to ten sam fakt jeszcze raz. Dym i reszta zostają.

### 4. Drzwi znów działają na klik
update51 wsadził wszystkie rozkazy pod dowódcę i zgarnął przy okazji drzwi —
`_handleDoorClick` odmawiał bez dowódcy. **Ręka przy klamce to nie rozkaz.**
Klik w pojedynczy właz działa zawsze; OPEN ALL / CLOSE ALL zostają pod dowódcą,
bo to statek działający jako całość. To jest teraz cała reguła.

### 5. Kwadraciki zamiast pasków, węższe panele
Pasek mówi „trochę"; kwadraciki mówią LICZBĘ. **Pięć pól po 20 HP**
(`Renderer.PIP_HP`), jeden `drawPips` na całą grę, żeby trzy odczyty tej samej
liczby nie rozjechały się w trzy różne wyglądy. Dwadzieścia na pole, nie
dziesięć: dziesięć pól na karcie 120 px to znowu pasek, tylko brzydszy.
Ranny na ostatnim punkcie ma nadal JEDEN zapalony kwadracik — pusty rząd czyta
się jako trup. Karty załogi 120 → **100 px**, panel rozkazów `ORDER_BW` 58 →
**48** (razem 100), prawy panel `drawCrewPanel` 180 → **150**. Pasek AIR zostaje
paskiem: to sekundy, a nie zliczanie.

### 6. Imiona się nie powtarzają, i można je zmienić
Każde imię w grze było `Utils.pick(CREW_NAMES)` — losowanie ZE ZWRACANIEM z 32
imion, więc siedmioosobowe koszary miały ponad połowę szans na dwa te same.
`pickUniqueName(pool, taken)` w `crew.js` jest teraz jedynym miejscem, gdzie
imię się losuje; `taken` przychodzi Z ZEWNĄTRZ (`Base.takenNames()`), bo lista
zajętych imion nie jest faktem tego pliku — mieszka w koszarach, zagrodach i
mesie. Po wyczerpaniu puli imię dostaje cyfrę rzymską zamiast się powtórzyć.
`Base.renameCrew(id, name)` — jedne drzwi dla ręki, kota i dowódcy; przycisk
RENAME na karcie w CREW **i** w teczce dowódcy; duplikat i puste imię są
ODMAWIANE. Pole tekstowe czyta `Input.typedChars()` (nowe): `e.key`, nie
`e.code`, bo `code` to POZYCJA klawisza i do pisania się nie nadaje.

### 7. Baza pamięta, kto leciał
`BaseScreen.open()` kasował wybór i odhaczał „pierwszych czterech z koszar" przy
KAŻDYM wejściu — a kolejność listy zmienia się przy każdym werbunku i każdej
śmierci, więc te „pierwsze cztery" nie były nawet te same dwa razy. To było to
zaznaczanie i odznaczanie samo z siebie. `b.lastCrew` zapisywane w
`Base.launch()`, przy wczytaniu zawężone do tych, którzy WRÓCILI. Automat
odhacza tylko bazę, która nigdy nie startowała.

### 8. Ikona wrogiego dowódcy ginie razem z kadłubem
`Commander.setEnemy(null)` trzeba było pamiętać w PIĘCIU wyjściach z walki —
i wyjście bossa zapominało, więc odznaka pobitego dowódcy wisiała nad pustką.
Odznaka nie jest osobnym faktem, tylko zdaniem „przede mną jest wrogi statek i
ktoś nim dowodzi". Renderer pyta teraz o KADŁUB (`state.enemyShip`), więc nie da
się jej zostawić i żadne przyszłe wyjście nie musi niczego pamiętać.

### 9. Zniszczony statek nie kończy abordażu
`_updateActive` ogłaszał zwycięstwo w sekundzie, w której kadłub wroga schodził
do zera — podczas gdy jego ludzie machali siekierami w naszym medyku. Teraz to
DWA fakty: statek ginie, kiedy ginie kadłub (wybuch, koniec ostrzału), a BITWA
kończy się dopiero, gdy nikt z ich strony nie stoi na naszym pokładzie —
`CombatManager.intrudersAboard()`, jedno zdanie, i szczury się nie liczą.
Nasi abordażyści są ściągani z wraku w chwili jego śmierci, nie na ekranie
zwycięstwa. Do tego dwie rzeczy przy leczeniu: **nikt nie opatruje cudzych**
(pętla `crew.forEach` chodziła po OBU stronach, a `crewInRoom` pod nią jest
jednostronne — więc nasi opatrywali ich abordażystów), i **nikt nie klęka w
środku bijatyki** — `roomContested` blokuje zarówno pomoc w polu, jak i medyka.

### 10. Kota da się leczyć
Medyk czytał `crewOperating`, które odfiltrowuje bestie, żeby kot nie obsadzał
działa. Ale medyk to nie konsola: leżenie na stole to nie robota.
`Ship.medbayPatients(roomId)` — mieszkańcy pokoju NASZEJ strony, kot włącznie,
i puste, kiedy o pokój się biją. W klinice na stacji `!c.isBeast` zamieniony na
`!c.isVermin && !c.isSpider` — filtr celował w szczura-pasażera, a łapał kota.

### 11. Wracasz tym, czym leciałeś
`_shipIdx = 0` przy każdym wejściu do bazy. Kadłub jest przy starcie WYCINANY z
hangaru i po powrocie dopychany na KONIEC listy, więc żaden indeks nie przeżywa
lotu — baza pamięta `lastShipKey` i wybiera OSTATNI wpis o tym kluczu, czyli ten,
który właśnie wylądował, a nie siostrzany kadłub, który stał w domu.

### 12. Cloak nie zamraża dział
W silniku nie ma i nie było gałęzi wiążącej ładowanie z maskowaniem — sekcja 173
przybija to dla obu stron. Widoczna przyczyna była w rysowaniu: paski ładowania
na mocowaniach szły przez pulsującą `globalAlpha` maskowania, więc migotały na
jednej trzeciej jasności i **czytały się jako zatrzymane**. Mocowania rysują się
teraz z pełnym kryciem. Pole ukrywa kadłub, nie jego zegar.

### 13. SELL pyta
Sprzedaż to jedyna akcja w bazie bez cofnięcia, więc jedyna, która pyta.
Modal w tej samej konwencji co teczka: rysowany ostatni, **czyści `_zones`**,
żyją tylko jego przyciski. `_confirmRects()` jest jedynym źródłem geometrii.
Pytanie trzyma AKCJĘ, nie kopię ceny i nazwy — odczytuje je dopiero przy
odpaleniu, więc nie da się sprzedać czegoś innego, niż napisano.

### 14. Odinstalowana broń już nie znika
`Base.uninstallWeapon` zdejmował działo, zapisywał kadłub BEZ niego i dopiero
potem szukał miejsca na półce — pełny magazyn NISZCZYŁ broń i zgłaszał błąd po
fakcie. Teraz odwrotnie: wszystko, co ma być odłożone, jest najpierw układane na
KOPII półki, i działo schodzi z mocowania dopiero, gdy każda skrzynia ma miejsce.

### 15. Boss płaci chip na wyjściu, którym naprawdę wychodzi
Chip był wypłacany w `_onWin`, do którego dochodzi się tylko przez
`CombatManager.isVictory()` — a boss NIGDY tamtędy nie idzie: śmierć ostatniej
fazy podnosi `defeated` w maszynie bossa, która leci prosto w `_finishContract()`
i wychodzi. Gwarantowana nagroda po prostu nie istniała. Teraz `_payBossChip()`
jest jedynym kasjerem, wołanym z OBU wyjść, i pamięta **który kadłub** zapłacił,
a nie CZY ktoś zapłacił — bo flaga, którą trzeba pamiętać zerować, to kształt
każdego błędu dryfu w tym projekcie. Przebieg łamania złapał dokładnie to.

### Przy okazji: migotliwy test
Sekcja 169 twierdziła „i nigdy wróg" przez `bonusFor(wróg).melee === 0`. Ale
`bonusFor` daje wrogiej ręce chipy WROGIEGO dowódcy, a ten losuje się w mniej
więcej jednej piątej walk — więc test padał ~3 razy na 12, a przez pozostałe
przechodził Z NIEWŁAŚCIWEGO POWODU (nie było wrogiego dowódcy, a nie: rozkaz się
zatrzymał na burcie). Mierzy teraz RÓŻNICĘ przed i po rozkazie.

### Testy
Nowe sekcje **171–183**: powietrze, brak czerwonej plamy, cloak a ładowanie,
kot jako pacjent, odmowa demontażu, SELL z pytaniem, pamięć bazy, odznaka wroga,
chip bossa, unikalne imiona i zmiana nazwy, abordaż po śmierci kadłuba, strony
przy opatrywaniu, kwadraciki i szerokości paneli.
Razem **2903 asercje + 79 kroków rysowania + 66 w przeglądarce**.

**Nowe narzędzie: `tests/break_check.js`** — przebieg łamania jako skrypt w repo,
a nie jako coś, co się pisze od nowa co paczkę. Cofa każdą poprawkę po jednej,
odpala trzy pakiety i melduje, których REVERTÓW testy nie zauważyły. Anchor musi
trafić dokładnie raz, pliki wracają na miejsce nawet po wyjątku.
Przebiegi: **20/21 → 21/21 → 26/28 (po dołożeniu subtelniejszych) → 27/28 →
28/28.** Trzy prawdziwe luki: losowe imiona (test przechodził na zepsutej wersji
7 razy na 10), medyk leczący w trakcie bijatyki, i flaga chipu bossa — ta
ostatnia zniknęła razem z flagą.

## 5-0az. ZMIANY update53 (8 ROZKAZÓW SPECJALNYCH, WSZYSTKIE ROZKAZY W JEDNYM MIEJSCU)

### 1. OSIEM ROZKAZÓW SPECJALNYCH, po jednym na umiejętność
Zalogant, który przed awansem **opanował umiejętność na 3/3**, wnosi ten fach na
mostek: jeden rozkaz, który umie wydać tylko dowódca, co sam tę robotę robił.
Lista `specialties` na rekordzie (zapisywana od update52) jest CAŁYM źródłem
tego, które rozkazy ma.

| umiejętność | rozkaz | co robi |
|---|---|---|
| Piloting | **EVASIVE PATTERN** | +25% uniku na 8 s |
| Engines | **FLANK SPEED** | +15% uniku na 8 s **i skok ładuje się 2×** |
| Weapons | **FULL SALVO** | każde działo natychmiast naładowane |
| Shields | **EMERGENCY BUBBLE** | osłony wracają do pełna, natychmiast |
| Repair | **DAMAGE CONTROL** | każdy uszkodzony moduł odzyskuje jeden poziom |
| Firefight | **FIRE SUPPRESSION** | wszystkie pożary gasną |
| Breach | **HULL SEAL** | wszystkie wyrwy zaszyte |
| Combat | **BATTLE FURY** | +50% obrażeń wręcz załogi na 10 s |

**RAZ NA WALKĘ**, każdy — Twój wybór zamiast cooldownu, i lepsza reguła: rozkaz,
który można wydać raz, jest decyzją KIEDY. Cooldown byłby pytaniem, czy klikasz
dość często. Granicą walki jest `_startCombat` — jedno miejsce, w którym zaczyna
się każdy pojedynek.

**ROZKAZ, KTÓRY NIC BY NIE ZROBIŁ, JEST ODMAWIANY — NIE ZUŻYWANY.** To jest
najważniejsza rzecz w tej paczce. Skoro masz go raz, spalenie jedynego
FIRE SUPPRESSION na statku, który się nie pali (i dostanie wesołego komunikatu o
tym) byłoby najgorszym możliwym czytaniem słowa „raz". Więc robota jest liczona
NAJPIERW, a rozkaz odznaczany dopiero, jeśli było co robić. Odmowa mówi, czego
brakuje:

* FULL SALVO przy naładowanych działach → *„every gun is already hot"*
* EMERGENCY BUBBLE przy pełnej bańce, DAMAGE CONTROL na całym statku,
  HULL SEAL na szczelnym kadłubie, FIRE SUPPRESSION bez ognia
* **EVASIVE PATTERN przy pustym kokpicie** — unik to ZERO bez pilota (najstarsza
  reguła tego modelu statku, działa przed każdym bonusem), więc +25% z niczego
  byłoby rozkazem wyrzuconym w kosmos.

### 2. WSZYSTKIE ROZKAZY W JEDNYM MIEJSCU
Do update52 drzwi i pozycje załogi były pod załogą, a **BOARD, RECALL i RETREAT
przez cały czas siedziały na górze ekranu** — trzy przyciski, które są rozkazami
w każdym sensie oprócz tego, gdzie były narysowane. Gracz musiał znać dwa
miejsca, a te dwa miejsca zdążyły się rozjechać: prostokąt BOARD był wypisany
ręcznie w rysowaniu **i drugi raz** w obsłudze kliknięcia.

Teraz jest jeden panel pod ikonami załogi:

```
ORDERS                    (albo ORDERS — NO COMMANDER)
[SAVE POS] [RETURN]
[OPEN ALL] [CLOSE ALL]
[BOARD]    [RECALL]
[RETREAT ...........]
SPECIAL (n)
[⥁][✹][⚔][⌁]            po 4 w rzędzie, do ośmiu
```

`Renderer.orderRects()` jest JEDYNYM źródłem tej geometrii — i obrazek, i test
trafienia czytają je stamtąd, więc przycisk nie może się przesunąć na ekranie bez
swojego kliknięcia. Nad ekranem walki zostały tylko PASKI POSTĘPU (ładowanie
skoku, abordaż w locie) — to stany walki, nie przyciski, i należą tam, gdzie
gracz i tak patrzy.

BOARD/RECALL/RETREAT są rysowane CIEMNO poza walką, nie chowane: panel, który
zmienia kształt między mapą a walką, to panel do nauczenia się od nowa co skok.

Zużyty rozkaz jest **szary i przekreślony** (sam szary czyta się jako
„jeszcze nie", a ten nie wróci do końca walki), działający jest **podświetlony**,
a **najechanie myszą pisze nazwę i opis** — osiem glifów w rzędzie to inaczej
osiem zagadek.

### 3. Jak to jest spięte
* `COMMANDER_ORDERS` (tabela) i cała księgowość w `commander.js`, obok każdego
  innego pytania „ile wart jest szef w tej chwili".
* `Commander.orderRefusal(key)` — **JEDNA** implementacja reguły „czy może".
  game.js pyta o powód (musi coś powiedzieć graczowi), a `giveOrder` pilnuje nim
  własnego rekordu. Wcześniej każde z nich sprawdzało osobno — dwie kopie „czy
  opanował" i dwie „czy już wydał", czyli kształt każdego błędu dryfu w tym
  projekcie.
* `Commander.orderBonus(effect)` — **JEDEN** rozjemca. Dwa rozkazy płacące w to
  samo NIE dodają się: wygrywa lepszy, bo dowódca, który akurat opanował oba
  fachy, nie może dostać liczby, której nikt nie balansował. EVASIVE PATTERN i
  FLANK SPEED są dokładnie taką parą.
* FLANK SPEED ma **jeden zegar na dwie połówki** (unik + szybszy skok) przez pole
  `alsoEvasion`, a nie drugi rozkaz — inaczej połówki jednego rozkazu mogłyby się
  skończyć w różnych momentach.
* Unik z rozkazu jest **WEWNĄTRZ** tego samego klamra co wszystko inne (75%, 90%
  pod maskowaniem). Osobna reguła dla jednego źródła to sposób, w jaki limity
  przestają cokolwiek znaczyć.
* Zegary chodzą na czasie walki (`_updateCombat`), nie na niczym, co woła test.

### 4. Poprawione przy okazji
Sprzątając stary kod: **prostokąt BOARD istniał w dwóch kopiach** (rysowanie i
klikanie). Nie zdążył się rozjechać, ale czekał na pierwszą osobę, która by go
przesunęła. Teraz jest jeden.

### 5. Testy
Nowe sekcje **169** (osiem rozkazów: tabela, kto co ma, raz na walkę, odmowa bez
zużycia, efekty, zegary, limit, wróg) i **170** (jeden panel, ten sam prostokąt
w rysowaniu i w kliknięciu, żadne dwa przyciski się nie nakładają, panel idzie za
listą załogi). Nowy krok rysowania na wygląd zużytego/działającego rozkazu i na
podpowiedź pod myszą.

Łamanie na złość: **11/12 → 25/33 → 6/6 → 6/9 → 5/5**. Każdy wyciek załatany i
sprawdzony ponownie. Dwa z nich były ciekawe:

* trzy „wycieki" okazały się testami, które PRZECHODZIŁY Z NIEWŁAŚCIWEGO POWODU —
  np. „rozkaz, którego nie zna, jest odmawiany" przechodziło na zepsutej wersji,
  bo ten rozkaz i tak nie miał co robić. Testy dostały teraz warunki, w których
  rozkaz BY ZADZIAŁAŁ, gdyby był dozwolony.
* scalanie „dwa rozkazy w jeden efekt" było **kodem nieosiągalnym** — po
  przeprojektowaniu żadne dwa rozkazy nie dzieliły klucza efektu, więc gałąź nie
  dała się wywołać. Nieosiągalny kod z pewnym siebie komentarzem jest gorszy niż
  brak kodu, więc przechowywanie przeniosłem na klucz ROZKAZU, a rozjemstwo do
  `orderBonus` — jedno miejsce, osiągalne i sprawdzone.

## 5-0ba. ZMIANY update52a (SPECJALIZACJE WYJAŚNIONE, TECZKA DOWÓDCY, UI MESY)

Mała paczka poprawek do update52. Bez nowych mechanik poza teczką.

### 1. SPECJALIZACJA TO 3/3, i teraz karta to MÓWI
**Reguła w kodzie była już dobra** — `Commander.masteredOf()` liczyło wyłącznie
umiejętności na poziomie 3, sprawdzone:

| zalogant | ranga | specjalizacje |
|---|---:|---|
| 3 umiejętności po 1 kwadracie | 3 | **0** |
| 3 umiejętności po 2 kwadraty | 6 | **0** |
| 3 umiejętności po 3 kwadraty | 9 | **3** |

Zepsute było UI: karta awansu pisała „3 **bonus picks**" i to się czytało jako
trzy specjalizacje. Poprawione:

* karta kandydata ma osobną linię `specialisations (3/3): Repair, Weapons` albo
  **`specialisations: none — a skill counts only at 3/3`** wypisane wprost;
* pod nią są **kropki umiejętności** — 3 pipsy na umiejętność, wypełnione do jego
  poziomu, żeby „jedna kropka w trzech umiejętnościach" było WIDAĆ, a nie trzeba
  było wyliczać z rangi;
* „bonus picks" → **„level-up picks"**, bo to są poziomy, nie specjalizacje.

### 2. TECZKA DOWÓDCY — jedno okno, dwoje drzwi
`Renderer.drawCommanderDossier()` rysuje wszystko o jednym dowódcy: kto, ranga,
poziom, pasek XP z liczbą, karma i **co ta karma faktycznie daje** (ile kolumn
Ethos / Dominance), niewydane poziomy, jego bonusy, specjalizacje (albo „none" i
dlaczego), oraz **planszę CPU 5×5 tylko do odczytu** — z chipami, martwymi na
czerwono i numerem poziomu na każdym nieodkrytym kwadracie.

Otwiera się z DWÓCH miejsc, jednym kodem (dwie kopie tego układu byłyby drugą
rzeczą do utrzymania w prawdzie):

* **klik w kartę w mesie** — cała karta jest przyciskiem, ale strefa jest
  wpychana OSTATNIA, po prawdziwych przyciskach, bo `_zones` idzie od początku i
  strefa wielkości karty połknęłaby każde kliknięcie w FLY HIM;
* **klik w pasek dowódcy na HUD, na mapie** — to była rzecz, o którą prosił
  gracz: po starcie kontraktu nie było jak zobaczyć karmy ani planszy. Nie w
  walce: liczby dowódcy to nie jest coś, co się czyta pod ostrzałem.

Modal jest MODALNY: w bazie `_zones` jest czyszczone przed narysowaniem teczki,
na mapie `_updateMap` robi `return` — bo modal, pod którym LAUNCH albo węzeł
skoku zostaje żywy, to modal, który się naciska przez przypadek. Klik obok panelu
zamyka, tak jak każdy odruchowo próbuje.

### 3. KOLEJKA DO AWANSU SIĘ PRZEWIJA
Było: pierwszych pięciu i napis „…and N more in the barracks" — czyli lista,
której dna nie da się dotknąć. Koszary na dwunastu miały siedmiu ludzi, których
gracz widział w liczniku i nie mógł awansować.

Jest: okno 3 kart, pasek przewijania, przyciski ▲/▼ i licznik `1–3 of 9`.
**Jeden klamer**, w miejscu rysowania, i wartość jest ZAPISYWANA z powrotem —
dwa klamry dla jednej liczby to dryf, za który ten projekt już płacił.

### 4. UI MESY — kolizje napisów
Znalezione i naprawione (trzy prawdziwe nakładki):

* podtytuł mesy szedł 540 px od `px+20` i przechodził **przez** nagłówek
  `READY FOR THE CHAIR` w kolumnie kandydatów. Rozbity na dwie krótkie linie
  wewnątrz swojej kolumny.
* linia karmy na karcie kojca (`karma 50 · 2 good / 2 evil · 8/25 cells`) szła
  **przez liczbę XP**. To była ta brzydota, którą gracz zgłosił. Karta jest teraz
  streszczeniem — nazwisko, ranga, pasek XP, jedna linia statusu — a cały detal
  przeniesiony do TECZKI, gdzie jest na niego miejsce.
* status na dole karty nie był przycinany względem podpowiedzi po prawej.
  Kolumna przycisków jest teraz ZAREZERWOWANA i każdy tekst na karcie jest
  przycinany do niej, nie do krawędzi karty.

**Test rysowania sprawdza kolizje wprost**: bierze wszystkie napisy z panelu,
liczy ich prostokąty (z uwzględnieniem `textAlign`) i wywala się, jeśli dwa
zachodzą na siebie w tym samym wierszu. Grupuje wiersze z tolerancją ±6 px, bo
przy dokładnym `y` prawdziwa kolizja (180 vs 182) przechodziła bokiem.

### 5. Znaleziony przy okazji: pusta plansza wrogiego dowódcy
Przy jednym kwadracie na poziom dowódca poziomu 2 ma dwa kwadraty, a blokada
karmy może zabrać jeden — więc wylosowany chip poziomu II nie miał gdzie wejść i
plansza wychodziła PUSTA. Wróg z poziomem bez konsekwencji.
`rollEnemy` ma teraz zapasowe chipy poziomu I (jeden kwadrat, wchodzą wszędzie,
gdzie pozwala jego sumienie).

**Uczciwy skraj, którego NIE zasłaniam:** dowódca poziomu 1 z karmą ≤14 ma
dokładnie jeden kwadrat i blokada stoi właśnie w nim — zero użytecznych pól.
Plansza jest pusta, bo reguły tak mówią, i test to stwierdza wprost zamiast
udawać, że tak nie jest.

### 6. Testy
Nowe sekcje **166** (reguła 3/3 i co mówi karta), **167** (przewijanie kolejki),
**168** (teczka z obu drzwi, modalność, zamykanie).
Łamanie na złość: **21/28 → 25/28 → 6/6**. Każdy wyciek załatany i sprawdzony.

## 5-0bb. ZMIANY update52 (25 RANG, DOWÓDCA 1–24, PLANSZA PO KWADRACIE, GRA PO ANGIELSKU)

**UWAGA — dwie rzeczy z update51 zostały SKASOWANE, nie rozbudowane:**
system tierów awansu (`maxRows` / `maxChipLevel` / ceny 100–400) i automatyczny
bonus korporacji za poziom. Oba zastąpione, bo oba były drugim rejestrem tej
samej liczby. Nic po nich nie zostało w kodzie.

### 0. KAPITAN → SHIP COMMANDER, i cała gra po angielsku
„Captain" jest teraz RANGĄ (nr 14 na drabince), więc człowiek na mostku to
**Commander**. Zmieniona nie tylko etykieta: `js/captain.js` → `js/commander.js`,
`Captain` → `Commander`, `base.captains` → `base.commanders`, `run.captainId` →
`run.commanderId`. Zostawienie starej nazwy w kodzie obok nowej rangi o tej samej
nazwie było proszeniem się o pomyłkę.

**Migracja jest i jest przetestowana** (sekcja 164): stary zapis z `captains`
przenosi listę do `commanders` i KASUJE stary klucz, a kontrakt zapisany w locie
czyta jeszcze `run.captainId`, żeby dowódca nie wyparował w połowie lotu.

Wszystkie polskie napisy w UI przetłumaczone: nazwy i opisy 12 chipów, Etos →
Ethos, Dominacja → Dominance, komunikaty rozkazów, kapsuła, ekran ładowni,
`NIE DZIAŁA` → `DEAD`, `BRAK KAPITANA` → `NO COMMANDER`.

### 1. 25 rang, liczonych z kwadracików (`js/crew.js`)
8 umiejętności × 3 poziomy = 24 kwadraty, plus Rekrut = 25 rang. Ranga jest
**LICZONA** z arkusza umiejętności (`rankLevelOf`), nigdy przechowywana — nie ma
jak się rozjechać z arkuszem.

`Recruit · Private · Private First Class · Specialist · Corporal · Senior Corporal ·
Sergeant · Senior Sergeant · Staff Sergeant · Warrant Officer · Senior Warrant
Officer · Chief Warrant Officer · Second Lieutenant · Lieutenant · Captain · Major ·
Lieutenant Colonel · Colonel · Commodore · Rear Admiral · Vice Admiral · Admiral ·
Grand Admiral · High Lord · Master Lord`

**`MAX_MASTERED` SKASOWANE.** Limit 3 mistrzostw na osobę robił z 24 kwadratów
liczbę nieosiągalną, a więc z 11 najwyższych rang i 6 ostatnich kwadratów planszy
CPU — dekorację. Gwiazdka przy nazwisku jest teraz WYPROWADZONA z rangi
(`starForRank`: srebrna od 5, złota od 14) zamiast liczona osobno w dwóch
miejscach z różnymi progami, jak było do update51.

### 2. Dowódca ma 24 poziomy i zaczyna od rangi zaloganta (`js/commander.js`)
`COMMANDER_MAX_LEVEL = MAX_RANK` — jedna drabinka, nie dwie. Awansujesz
zaloganta rangi 12 → dostajesz dowódcę **poziom 12**, z 12 kwadratami CPU i 12
wyborami bonusu do wydania. Krzywa XP to wzór (`120 · n^1,6`), nie 24 ręcznie
wpisane liczby, bo 24 ręcznie wpisane liczby to 24 okazje do pomyłki.

**Cena awansu wykładnicza:** `80 · 1,20^ranga`, zaokrąglona do 10.
Recruit 80 CC · Corporal 170 · Captain 1230 · **Master Lord 6360**.

Awansować można każdego żywego człowieka. Odmawia tylko zwierzęciu (`isBeast`,
`catKind`, pet/spider/vermin) i trupowi.

Przy awansie zapisywana jest lista `specialties` (opanowane umiejętności) —
**update53 zrobi z każdej z nich rozkaz specjalny**, a rekord z koszar wtedy już
nie istnieje, więc nie ma skąd tego odczytać później.

### 3. Plansza CPU: JEDEN KWADRAT NA POZIOM (`js/chips.js`)
5×5 = 25 kwadratów, 24 poziomy + ranga startowa = 25 kroków. Idealnie.
Odkrywa się w kolejności czytania — od lewej wzdłuż górnego rzędu (dobra strona),
potem w dół. 5 poziomów = 1 pełna linia; 12 poziomów = 2 pełne linie + 2 kwadraty
w trzeciej, dokładnie jak w opisie gracza.

`rowsFor` / `rowOpensAt` / tiery z update51 — **usunięte**. Zamiast nich
`cellsFor`, `cellIndex`, `cellOpen`, `cellOpensAt`, `openRows`.
Kolumna blokady karmy działa bez zmian i jest ORTOGONALNA do poziomu.

**Na ekranie:** kwadrat jeszcze nieodkryty jest KAMIENNY i **ma wypisany poziom,
który go otworzy** (25 kwadratów odkrywanych po jednym jest czytelne tylko wtedy,
gdy każdy mówi, kiedy jego kolej). Blokada karmy zostaje pomarańczowa i
kreskowana — bo to dwie różne rzeczy: jedno otworzy się samo, drugie tylko przez
zmianę tego, jakim się jest człowiekiem.

### 4. Awans to DECYZJA, którą gracz widzi (`js/game.js`, ekran `promo`)
Automatyczny bonus korporacji za poziom **skasowany** — przy 24 poziomach Terra
dawałaby +24% HP i +48% naprawy za nic. Zamiast tego każdy poziom to jeden wybór
**+0,5% w jednej z DWÓCH rzeczy, którymi handluje jego korporacja**:

| korporacja | do wyboru |
|---|---|
| Aquarius | max HP / szybkość |
| Pegasus | szybkość / łatanie wyrw |
| Terra | max HP / naprawa |
| Phoenix | walka wręcz / gaszenie |

Ekran otwiera się: **od razu po awansie** (rangi 12 = dwanaście razy) i **po
bitwie**, tyle razy ile poziomów wskoczyło. Napędza go `Commander.picksOwed()` =
`level − picksMade`, czyli liczba LICZONA, a nie licznik, który ktoś musi
pamiętać zwiększyć — więc ekran nie może się rozjechać z poziomami, przetrwa
zamknięcie gry i nie da się go przegapić.

Nie otwiera się w środku strzelaniny (`_checkPromo` sprawdza `inProgress()`).
Jedno kliknięcie = jeden wybór (przytrzymanie przycisku nie wydaje wszystkiego).
Wybór HP przelicza paski załogi w TEJ SAMEJ klatce, nie przy następnym starcie.

Wrogi dowódca wydaje swoje poziomy sam, w `rollEnemy`, przez to samo
`spendPick` — inaczej jego poziom byłby liczbą bez konsekwencji.

### 5. Decyzje karmiczne mają kolor (`js/game.js`)
Wybór dodatni na zielono, ujemny na czerwono, obojętny bez zmian — i każdy
karmiczny **wypisuje swoją cenę** (`+5 KARMA`), bo sam kolor nie przeżyje
daltonisty i nie mówi ILE. Kolor jest czytany z `choice.result.karma`, czyli z tej
samej liczby, którą wybór faktycznie płaci — nowego eventu nie da się dodać
bezbarwnie przez zapomnienie flagi.

### 6. Testy
* **`tests/harness.js`**: `GAME_EXPORT` obejmuje teraz CAŁY publiczny return
  game.js (z klamrą), bo dopasowanie fragmentu zostawiało ogon prawdziwego
  obiektu wiszący za podmianką.
* `Game.state()` — jedno słowo, tylko do odczytu. Ekran awansu to pierwszy pełny
  panel bez własnego modułu, którego można by zapytać.
* Nowe sekcje **163** (rangi, cena, kwadraty), **164** (ekran awansu, migracja
  zapisu), **165** (kolory karmy). Sekcja 140 przepisana na system wyboru.
* Pętle „wydaj wszystkie punkty" w testach są OGRANICZONE — `while (owed > 0)` w
  teście to zawieszenie czekające na okazję, a zawieszenie to jedyna awaria,
  której przebieg łamania nie umie zaraportować.
* `rollEnemy` też ma pętlę ograniczoną, z tego samego powodu, tylko że tam
  zawiesiłaby graczowi grę w walce.
* Łamanie na złość: **38/41 + 11/14 + 5/5 + 3/3 + 5/7 + 3/3**. Każdy wyciek
  załatany i sprawdzony ponownie.

### 7. Znalezione przy okazji
`Math.round(100 × 1,005) = 100` — pojedynczy wybór +0,5% HP jest NIEWIDOCZNY na
załogancie ze 100 HP; dopiero drugi rusza pasek. Przy 24 poziomach to się zbiera,
ale pierwszy wybór daje graczowi zerowy feedback. Do rozważenia przy balansie.

## 5-0bc. ZMIANY update51 (2× XP, ROZKAZY POD KAPITANEM, AWANS ZE SUFITEM)

**Stół testowy z update49a NIE ISTNIEJE.** `Base.devCaptain/devChips/devKarma`,
przycisk `TEST: KAPITAN + CHIPY` w mesie i przyciski `TEST karma ±10` na planszy
CPU zostały skasowane razem z ich testami (sekcja 157 w `run_tests.js` i dwa
kroki w `smoke_draw.js`). Testy chodzą teraz tą samą drogą co gracz —
`Base.promote()` — bo po zmianie zasad awansu ta droga jest wreszcie krótka.

### 1. XP × 2 (`js/crew.js`)
Cała tabela `XP_RATES` podwojona, co do jednej pozycji:

| co | było | jest |
|---|---:|---:|
| weapons (strzał) | 1.0 | **2.0** |
| piloting / engines (unik) | 8 | **16** |
| shields (warstwa) | 8 | **16** |
| repair (na sekundę) | 0.25 | **0.5** |
| firefight (na sekundę) | 5.0 | **10.0** |
| breach (na sekundę) | 6.0 | **12.0** |
| combat (cios) | 10 | **20** |

Koszt poziomu NIE zmieniony (`SKILL_DEFS[k].xpPerLevel = [50,150]`, mistrzostwo
dalej 200 XP) — podwojono wyłącznie tempo. Dzięki temu KSZTAŁT krzywej stoi:
łatanie dziury dalej płaci 1,2× gaszenia, unik dalej płaci tak samo pilotowi i
mechanikowi. Sekcja 161 pilnuje obu rzeczy naraz: wartości i proporcji.

### 2. Bez kapitana nie ma rozkazów (`js/game.js`, `js/renderer.js`)
Statek bez kapitana dalej LATA: załoga chodzi, obsadza konsole, gasi, łata,
strzela, moc się przestawia. Nie da się natomiast wydać rozkazu CAŁEMU
statkowi:

* pojedyncze drzwi (klik),
* `OPEN ALL` / `CLOSE ALL`,
* `ABORDAŻ`,
* `SAVE POS` / `RETURN`,
* `ODWRÓT`.

Jeden predykat `_hasCaptain()` i jedno `_needCaptain(co)` z jednym komunikatem —
nie sześć kopii warunku, bo sześć kopii rozjechałoby się przy pierwszej zmianie
treści. Ten sam predykat jest wystawiony jako `Game.hasCaptain()`, żeby renderer
rysował te przyciski szarym TYM SAMYM pytaniem, na które odpowiada obsługa
kliknięcia. Panel drzwi podpisuje się wtedy `BRAK KAPITANA` zamiast `DOORS`,
a `BOARD` i `ODWRÓT` mówią to samo wprost.

### 3. Awans: każdego można, ale kupujesz sufit (`js/commander.js`, `js/base.js`)
Stara zasada „tylko ten, kto opanował umiejętność" **zniknęła**. Zamiast bramki
jest CENA i TRWAŁY SUFIT planszy CPU, ustawiany w chwili awansu i nigdy później
niepodnoszony (`COMMANDER_TIERS`):

| awansowany | gwiazdki | max rzędów | max poziom chipa | cena |
|---|---:|---:|---:|---:|
| szeregowy | 0 | 2 | II | 100 CC |
| srebrna | 1 | 3 | III | 150 CC |
| dwie | 2 | 4 | IV | 250 CC |
| złota | 3 | 5 | IV | 400 CC |

`Commander.tierFor(rec)` / `priceFor(rec)` czytają tę tabelę, `fromCrew()` wpisuje
`stars`, `maxRows`, `maxChipLevel` na rekord kapitana, a `Commander.ceiling(cap)`
jest JEDYNYM czytnikiem — dzięki temu rekord zapisany przed update51 jest
poszerzany w jednym miejscu, a nie zgadywany w czterech. Kapitan ze starego
zapisu zachowuje CAŁĄ planszę (5 rzędów, chipy do IV): każdy z nich awansował
pod starą zasadą i grał bez sufitu, więc zamurowanie rzędów, które już zapełnił,
skasowałoby chipy należące do gracza.

`Commander.eligible()` odmawia już tylko temu, kto nie jest żywym człowiekiem —
zwierzęciu (`isBeast`, `catKind`, pet/spider/vermin) i trupowi.

### 4. Sufit działa na planszy (`js/chips.js`)
* `openRows(cap) = min(rowsFor(poziom), tierRows(cap))` — wiąże to, co wiąże
  pierwsze. Używa tego reguła siatki, `isInert` i `usableCells`.
* `isWalledRow(cap, y)` — rząd zamknięty NA STAŁE, inaczej niż rząd, który
  jeszcze się nie otworzył. To dwa różne pytania i każdy czytelnik zadaje to,
  o które mu chodzi.
* `overChipLevel(cap, it)` — chip powyżej sufitu nie wchodzi na planszę, a jak
  już na niej leży (zapis zawężony), to gaśnie tam gdzie leży i mówi dlaczego.
  Dokładnie tak, jak chip zabity przez karmę: nic się nie kasuje i nie przesuwa.

### 5. Ekrany mówią, co kupujesz (`js/basescreen.js`, `js/lootscreen.js`)
* Karta kandydata w mesie: cena JEGO tiera i linia `plansza CPU: max N rz. ·
  chipy do X`.
* Karta kapitana: `N/M rz.` — otwarte teraz / sufit — plus najwyższy chip.
* Plansza CPU: rząd zamurowany na stałe jest **kamienny, kreskowany w drugą
  stronę**, a nie pomarańczowy jak rząd czekający na poziom, i pod planszą stoi
  zdanie, że te szare rzędy nie otworzą się nigdy.

### 6. Testy
* **`tests/harness.js`**: stub canvasa oddawał `fillStyle`/`strokeStyle` jako
  funkcję, więc KAŻDY test próbujący sprawdzić KOLOR porównywał dwie funkcje i
  przechodził na wszystkim. `CTX_STYLE_PROPS` oddaje teraz to, co zapisano.
  Bez tego trzech rzeczy z tego update'u nie dałoby się w ogóle sprawdzić.
* Nowe sekcje **161** (XP × 2), **162** (bez kapitana nie ma rozkazów),
  **163** (tiery awansu, sufit rzędów i poziomu chipa, stary zapis, zwierzę).
* Nowe kroki rysowania: panel drzwi gaśnie, zamurowany rząd ma własne
  wypełnienie, mesa cytuje cenę TEGO kandydata.
* Sekcja 157 (stół testowy) skasowana.
* Łamanie na złość: 55/58 + 12/13 + 4/4. Każdy wyciek załatany i sprawdzony
  ponownie. Pierwsze przejście — jak zawsze — coś przepuściło; drugie i trzecie
  domknęły.

## 5-0bd. ZMIANY update50 (KARMA MA ŹRÓDŁA, KAPSUŁA LATA, WRÓG MA KAPITANA)

Druga połowa specyfikacji. Plansza CPU z update49 przestaje być
dekoracją: karma wreszcie się rusza od tego, co robisz.

### 1. KARMA ZA DECYZJE O BEZBRONNYCH

Jedna tabela w `commander.js` (`Commander.KARMA`) i **cztery prawdziwe wybory**,
które już były w grze:

| decyzja | karma |
|---|---:|
| Sygnał SOS cywila → **Rescue** | **+5** |
| Sygnał SOS cywila → Pass by | **0** |
| Kapitulacja wroga → **Accept tribute** | **+5** |
| Kapitulacja wroga → **No mercy, finish them** | **−10** |
| Danina → **Hand over a crew member** | **−10** |
| Latarnia → **Take their He2 by force** | **−5** |
| **Ewakuacja kapsułą** | **−10** |

Naprawy, gaszenie, leczenie i strzelanie do uzbrojonego wroga **nie dają
karmy** — to jest robota. Karma jest za decyzje o ludziach, którzy nie mogą
się odgryźć. Odmowa pomocy to **0**, nie kara: gracz ma własną załogę i wolno
mu o niej myśleć.

**Jedna decyzja liczy się raz**, bo wszystko przechodzi przez jedno miejsce —
`_resolveEvent`. Kontrakt **bez kapitana nie rusza niczyjej karmy**;
kapitanowie w mesie nie podjęli tej decyzji.

**Cena widoczna PRZED kliknięciem** (spec §8): na przycisku wyboru stoi
`KARMA −10 · 2 chip(ów) zgaśnie`. Decyzja moralna, którą gracz rozumie
dopiero po fakcie, nie jest decyzją.

### 2. KAPSUŁA RATUNKOWA

Jedyny chip, który **się zużywa**. Przycisk w walce pojawia się tylko wtedy,
gdy kapsuła jest ZAMONTOWANA i sprawna — w ładowni to zwykły ładunek.

Odliczanie 12 / 10 / 8 / 6 s wg poziomu, i **walka trwa w jego trakcie**.
Jeśli kadłub padnie albo zginie ostatni żywy załogant przed końcem — kapitan
ginie z nimi. Jeśli zdąży: wraca z poziomem, XP, karmą i **pozostałymi**
chipami, a statek, ładownia, cała załoga i kot **zostają**. Bez systemu wykupu
jeńców, zgodnie z §13.

**Kara −10 naliczana jest PO odstrzale.** Gdyby szła pierwsza, mogłaby
przesunąć ścianę pod kapsułą i unieruchomić ją w połowie jej własnego
odliczania.

### 3. WRÓG MA KAPITANA

`Commander.rollEnemy(sektor)` — poziom i plansza rosną z sektorem, boss ma go
zawsze. Zbudowany z **tych samych chipów i tych samych reguł**; wróg z
premiami z osobnego kodu byłby drugą implementacją całego systemu.

`bonusFor()` wybiera kapitana **po stronie, po której stoi załogant** — to
jedyne miejsce, gdzie te dwa sloty są w ogóle rozróżniane. Wrogi kapitan jest
**kasowany po każdej walce**: zostawiony płaciłby premie następnemu wrogowi,
niewidocznie, a trudność rosłaby bez niczego na ekranie.

Gracz widzi **odznakę: korporacja + poziom**, i nic więcej — żadnej planszy,
żadnej listy chipów (spec §9).

### PLIKI

`js/commander.js`, `js/game.js`, `js/map.js`, `js/renderer.js`,
`tests/harness.js`, `tests/run_tests.js`, `tests/smoke_draw.js`, `HANDOFF.md`

### TESTY

**2353 / 76 / 61** zielone. Nowe sekcje **158–160**. **22 celowe złamania,
wszystkie wykryte** — za drugim podejściem, jak zawsze. Pierwsze przepuściło
trzy i wszystkie trzy były tą samą dziurą: **testowałem funkcję, a nie jej
podpięcie**. Odliczanie kapsuły sprawdzałem wołając `_tickEvac` ręcznie, więc
wycięcie go z pętli walki niczego nie psuło; ostrzeżenie o karmie w oknie
wyboru nie miało testu rysowania; a czyszczenie wrogiego kapitana po walce
nikt nie sprawdzał. Teraz test przepycha prawdziwe `_updateCombat` i prawdziwe
`_onWin`.

### CO ZOSTAŁO ZE SPECYFIKACJI

**Chipy w sklepach stacji orbitalnych** (§9). Ekran stacji to DOM w `ui.js`,
nie canvas, więc to osobna robota — a chipy i tak mają dwa działające źródła
(wraki i bossowie). Jedyna niezrobiona pozycja z całego dokumentu.

## 5-0be. ZMIANY update49a (STÓŁ TESTOWY DO PLANSZY CPU)

Zgłoszenie gracza: *„nie mogę sprawdzić, bo nie mam kapitana"*. I słusznie —
kapitan wymaga załoganta z OPANOWANĄ umiejętnością, czyli ośmiu do dziesięciu
walk dedykowanej pracy, a karma do update50 nie ma **żadnych** źródeł, więc
ściana i tak nigdy by się nie ruszyła. Plansza była nie do obejrzenia.

### DRZWI Z NAPISEM TEST, NIE ZMIĘKCZONA REGUŁA

`Base.devCaptain()`, `Base.devChips()`, `Base.devKarma()` — trzy osobne
wejścia, każde oznaczone słowem TEST w komunikacie i na przycisku.
**`promote()` jest NIETKNIĘTE**: dalej kosztuje 100 CC i dalej żąda
mistrzostwa. To jest ważne, bo §13 specyfikacji ma „kupowanie gotowych
kapitanów" na liście świadomie odrzuconych rzeczy — a to nie jest kupowanie,
tylko stół testowy.

- **MESA → `TEST: KAPITAN + CHIPY`** — sadza kapitana na poziomie 8 z karmą
  50 (bierze pierwszego z koszar, żeby imię i korporacja były prawdziwe;
  jak koszary puste, tworzy nowego) i **stawia 20 chipów na półce**: trzy
  rodziny, poziomy I–III, w tym kapsuła. Poziom 8 otwiera wszystkie pięć
  rzędów, więc widać całą planszę od razu. Liczbę koi w mesie **respektuje**.
- **PLANSZA CPU → `TEST karma −10 / +10`** — bez tego ściana nigdy się nie
  rusza. Po kliknięciu pasek u góry mówi nową karmę, numer kolumny blokady
  i ile kolumn zostało każdej stronie, a chipy po złej stronie natychmiast
  gasną i przekreślają się.

### CO OBEJRZEĆ

Wciśnij TEST w mesie → PLANSZA CPU → połóż Etos po lewej, Dominację po
prawej → wal w `TEST karma −10` i patrz, jak ściana jedzie w lewo, a chipy
Etosu po kolei umierają (zostają na miejscu, przekreślone, z powodem pod
planszą). Wróć plusem i zapalają się same.

### PLIKI

`js/base.js`, `js/basescreen.js`, `js/game.js`, `js/lootscreen.js`,
`tests/run_tests.js`, `tests/smoke_draw.js`, `HANDOFF.md`

### TESTY

**2291 / 74 / 61** zielone. Nowa sekcja **157** pilnuje przede wszystkim
tego, że **stół testowy nie stał się regułą gry**: `promote()` dalej odmawia
komuś bez mistrzostwa, bench dalej respektuje koje, a karma nie wychodzi poza
0–100. **12 celowych złamań, wszystkie wykryte** — jedno dopiero po
poprawieniu testu: sprawdzałem trwałość karmy, wołając najpierw `Save.save()`,
czyli zapisywałem dokładnie tę zmianę, której trwałość miałem udowodnić.
Test przechodził na zepsutej wersji.

### DO USUNIĘCIA PRZED WYDANIEM

Trzy funkcje `dev*` w `base.js` i dwa przyciski. Zostawione świadomie, bo
`update50` da karmie prawdziwe źródła i wtedy przyciski karmy przestaną być
potrzebne — kapitan z benchu może zostać dłużej, dopóki demo nie ma innego
sposobu na szybkie sprawdzenie mostka.

## 5-0bf. ZMIANY update49 (PLANSZA CPU, CHIPY, KARMA JAKO GEOMETRIA)

Pierwsza połowa ostatniej dużej rzeczy ze specyfikacji
(`Moon_Wars_Mechaniki_Kapitan_CPU_Karma_Koty.md`, §6–§9). Druga połowa —
źródła karmy, kapsuła ratunkowa, wrodzy kapitanowie, sklepy stacji — to
update50.

### KARMA NIE JEST MNOŻNIKIEM DPS, TYLKO KSZTAŁTEM PLANSZY

Plansza to **5 kolumn × 5 rzędów**, a jedna cała kolumna jest **ścianą**,
której pozycję wyznacza wyłącznie karma kapitana:

```
karma   0–14   15–34   35–65   66–85   86–100
ściana  kol. 1  kol. 2  kol. 3  kol. 4  kol. 5
dobro       0       1       2       3        4  kolumn
zło         4       3       2       1        0  kolumn
```

Na lewo od ściany wchodzi **Etos**, na prawo **Dominacja**, **Uniwersalne**
gdziekolwiek. Święty ma cztery kolumny Etosu i zero miejsca na Dominację;
rzeźnik odwrotnie; a człowiek ze środka — czyli każdy nowy kapitan — ma po
dwie kolumny i **nie zmieści paska III na żadnej stronie**. To jest cała
mechanika: to, co kapitan zrobił, zmienia **co się mieści**, a nie to, jak
mocno bije.

Rzędy otwiera poziom: 1 → 1, 2–3 → 2, 4–5 → 3, 6–7 → 4, 8 → 5.

### CHIP TO ZWYKŁY PRZEDMIOT

Zgodnie z Twoim ustaleniem (*„te chipy będą na tej samej zasadzie co
inventory nasze i przedmioty"*): chip to `CargoItem`, plansza to trzecia
`CargoGrid` obok półki i ładowni, a przenoszenie go to ten sam klik, co
przenoszenie beczki He2. **Chip jest na półce ALBO w ładowni ALBO na
planszy — nigdy w dwóch miejscach**, bo nie ma osobnego rejestru
„zamontowanych ulepszeń". To ten sam błąd, który dał trzy magazyny na jedną
półkę w update35.

12 chipów × 4 poziomy = **48 wpisów w katalogu, generowanych z jednej
tabeli** w `chips.js`. Kształty ze spec: Etos i Dominacja I–IV to 1×1, 2×1,
3×1, 4×1; **Uniwersalny IV to 2×2** — te same cztery pola, ale mieszczą się
na wąskiej planszy i wymagają drugiego rzędu, więc bramkuje je poziom, a nie
sumienie.

### MARTWY CHIP ZOSTAJE NA MIEJSCU

Kiedy karma przesunie ścianę pod chipem, chip **nie jest kasowany ani
przenoszony**. Zostaje dokładnie tam, gdzie był, jest przekreślony, wygaszony
i **przestaje płacić** — a pod planszą pisze, który i dlaczego. Wróć z karmą
i włącza się sam.

**„Nie działa" jest LICZONE, nigdy ZAPISANE.** Flaga `active` na chipie
byłaby drugą kopią karmy i rozjechałaby się przy pierwszym kontrakcie, który
ruszy wskaźnik. `Chips.isInert()` czyta karmę tej chwili, za każdym razem.

### JEDEN AKCESOR NA PREMIE

`Commander.bonusFor(crew)` dolicza teraz chipy **obok** premii korporacyjnej,
więc każde miejsce, które już pytało `_capBonus()` — maks. HP, prędkość
ruchu, tempo napraw, obrażenia wręcz — dostało chipy nie wiedząc o ich
istnieniu. Różnica między nimi jest realna: **premia korporacyjna idzie
tylko do swoich, chip do każdego na pokładzie.** Sumują się, nie mnożą.

Podpięte efekty: maks. HP, ruch, naprawy, wręcz, gaszenie, łatanie,
**redukcja obrażeń wręcz** (czytana z BRONIONEGO, nie z bijącego), **złota
godzina** (okno ratunku stemplowane w chwili powalenia — zmiana karmy nie
resetuje zegara nad leżącym), **pomocna dłoń** (opatrywanie w polu, nie
praca medbayu), **forsowanie ognia** (dokładane do premii działonowego i
przycinane tym samym istniejącym cappem 75%) i **wymuszenie** (CC z
kapitulacji; szansy na kapitulację nie rusza).

### SKĄD SIĘ BIORĄ

Wraki (18–27% na wrak, zależnie od sektora) i **gwarantowana nagroda bossa**:
Border Patrol daje II albo III, **Apophis jako jedyny w grze daje IV**.
Sektor jest sufitem: 1 → I, 2 → II, 3 → III. Jeśli ładownia jest pełna,
nagroda **nie znika** — otwiera się ekran, tak samo jak przy wygranej broni
(zasada z update48).

Sklepy stacji orbitalnych i wrodzy kapitanowie: **update50**, bo obie rzeczy
siedzą w warstwie stacji/walki, którą tamta paczka i tak rusza.

### PARAMETRY, KTÓRE SPEC ZOSTAWIŁ MNIE (§12)

- ceny chipów: sprzedaż 40 / 85 / 170 / 340 CC za poziom I–IV;
- rozkład poziomów w losowaniu: wagi 10 / 6 / 3 / 1 — pasek III jest szeroki
  i większość kapitanów nie ma go gdzie położyć, więc częsty byłby balastem;
- szansa chipa na wraku: 0,18 + 0,03 × sektor.

**Kara za ewakuację zostaje −10** (Twoja zmiana z −15 w
`decyzje-update43-kapitan.md` ma pierwszeństwo nad §3.2 spec).

### PLIKI

`js/chips.js` (NOWY), `js/commander.js`, `js/cargo.js`, `js/crew.js`,
`js/ship.js`, `js/game.js`, `js/basescreen.js`, `js/lootscreen.js`,
`index.html`, `tests/harness.js`, `tests/run_tests.js`,
`tests/smoke_draw.js`, `HANDOFF.md`

### TESTY

**2274 / 72 / 61** zielone. Nowe sekcje **154–156**: geometria planszy
(każda granica karmy osobno), chip jako przedmiot i jego premie, źródła
chipów. **30 celowych złamań, wszystkie wykryte** — za drugim podejściem.

Pierwsze przejście przepuściło **cztery**, i każde z nich było prawdziwą
dziurą w testach, nie złym złamaniem: ściana była pilnowana w dwóch
miejscach naraz, więc zdjęcie jednego nic nie psuło (dołożona asercja na
`blockedAt`); zakaz obracania testowałem na pasku, który i tak się mieścił
(teraz jedna kolumna i pasek III, który TYLKO po obróceniu by wszedł);
zamknięty rząd nie miał testu w ogóle; a zapis planszy przy zamknięciu
ekranu nie był sprawdzany end-to-endem. Piąty raz z rzędu.

**Prawdziwy bug znaleziony przez własny test:** `isInert` czytał maskę jako
`{w,h,cells}`, a `CargoItem.mask` to **tablica wierszy**. Pętla chodziła
zero razy i **każdy chip raportował się jako sprawny** — plansza płaciłaby
premie, których nie ma.

## 5-0bg. ZMIANY update48 (EKRAN ŁADOWNI: KLIK, PODZIAŁ STOSU, NIC NIE ZNIKA)

Trzy rzeczy z jednego zgłoszenia gracza, wszystkie o tym samym ekranie.

### 1. ZAZNACZANIE SZŁO ZA KURSOREM, NIE ZA KLIKNIĘCIEM

Gracz: *„zaznaczanie przedmiotów działa tylko na hover, a ma działać na
click; jak zaznaczam coś wyżej i jadę myszką w dół lub w bok, to zaznacza
ostatnią rzecz, a nie tę, co potrzebuję"*.

Dokładnie tak było napisane: pętla po `_cellAt` w każdej klatce ustawiała
`_sel` na cokolwiek leżało pod kursorem. Klikałeś He2 u góry, szedłeś myszą
w dół do SELL — i sprzedawałeś to, co było po drodze.

Do tego przenoszenie było **trzymaniem przycisku**: wciśnij, przeciągnij,
puść. Na pełnej siatce to długa droga z ciężką skrzynią pod kursorem, a
puszczenie o piksel obok odsyłało ją tam, skąd wyszła.

**Jeden model, i mysz znaczy wyłącznie to, co kliknięte:**

```
lewy klik na skrzyni   → bierzesz ją do ręki i ona jest zaznaczona
lewy klik jeszcze raz  → odkładasz tam, gdzie kursor
prawy klik / ESC       → wraca dokładnie tam, skąd ją wziąłeś
```

Najechanie na cokolwiek **nie zmienia niczego.** Klik w miejsce, gdzie się
nie mieści, **zostawia skrzynię w ręce** i mówi dlaczego — nie odsyła jej do
domu, bo to była połowa frustracji ze starym przeciąganiem.

### 2. SPLIT — DZIELENIE STOSU

Gracz: *„dodaj podział, tak aby gracz mógł dzielić przedmioty, jeżeli jest
ich kilkanaście, np. z 16 paliwa podzielić sobie na mniejsze"*.

Nowy przycisk **SPLIT — n** odkrawa **połowę** stosu do drugiego pojemnika
tego samego typu: 16 → 8+8, jeszcze raz → 4, jeszcze raz → 2. Jest
dokładnie odwrotnością TIDY, który stoi obok i skleja stosy z powrotem.

**Sztuki wychodzą ze starego pojemnika dopiero wtedy, gdy nowy naprawdę
stanął w komórce.** Jak nie ma miejsca ani tu, ani w drugiej ładowni, podział
jest odmawiany i nie ubywa ani jedna jednostka. Podział „w nigdzie" to
najprostszy sposób na skasowanie połowy paliwa.

### 3. NIC NIE ZNIKA — TO SIĘ DZIAŁO W TRZECH MIEJSCACH

Gracz (jeszcze przy update47): *„jak nie ma miejsca w magazynie statku lub
jak wraca pełny statek z kontraktu i jest pełny magazyn w bazie, to nie ma
być tak, że przedmioty znikają — gracz zawsze ma mieć możliwość, co przełożyć
a co wyrzucić"*.

**a) Dokowanie sprzedawało nadmiar samo z siebie.** Było:

```js
if (shelf && shelf.autoPlace(it)) stashedCount++;
else { cargoCC += it.value('general'); spilled++; }   // ← baza kupowała za ciebie
hold.clear();
```

Teraz, jeśli po ułożeniu tego, co się mieści, w ładowni coś zostaje,
**dokowanie zatrzymuje się i pyta**: półka i ładownia obok siebie, a wyjście
to przycisk, który mówi cenę — **SELL THE REST — n CC**. Sprzedać wolno; po
cichu nie. Ekran wyniku czeka, aż gracz odpowie (`_dockAtBase` dostał
callback, `_finishDocking` to reszta dokowania).

**b) Zmiana kadłuba wyrzucała ładunek za burtę.** W `_buildHold` były dwie
linijki i nie było trzeciej — gdy skrzynia nie mieściła się ani w nowej
ładowni, ani na półce, po prostu nie trafiała nigdzie. Teraz nowa para
siatek jest budowana **na próbę**; jak choć jedna skrzynia nie ma gdzie
pójść, nic nie jest zatwierdzane, a **klik w koję jest odmawiany**.

**c) Zamknięcie ekranu z przedmiotem w ręce.** Ręka nie jest pojemnikiem, a
`onClose` dostaje siatki — więc skrzynia trzymana w chwili, gdy skończył się
zegar na wraku, po prostu przestawała istnieć. `_finish()` odkłada ją teraz
zawsze, zanim cokolwiek się zamknie.

### PRZY OKAZJI

Przyciski działają też na skrzynię **trzymaną w ręce** — `_act` najpierw ją
odkłada (`_settle`), bo USE/SELL/DUMP pytają `_hold.items.includes(it)`.
Przy starym przeciąganiu przyciski były nieosiągalne w trakcie trzymania, więc
ten przypadek nigdy nie istniał.

Rząd przycisków zaczyna się od x=58 zamiast 120 — SPLIT doszedł do rzędu,
który już miał 936 px i kończył się 104 px przed DONE.

### PLIKI

`js/basescreen.js`, `js/game.js`, `js/lootscreen.js`,
`tests/run_tests.js`, `tests/smoke_draw.js`, `tests/browser_test.js`,
`HANDOFF.md`

### TESTY

**2174 / 70 / 61** zielone. Nowe sekcje **151–153** (klik zamiast hovera,
podział stosu, nic nie znika) plus przepisana **66**, która wcześniej
utrwalała dokładnie to zachowanie, które ta paczka kasuje: *„an item that
does not fit is still sold for CC"*.

`dragCanvas` w `browser_test.js` też przepisany — trzymał przycisk przez całą
drogę, czyli testował interakcję, której już nie ma.

**19 celowych złamań, wszystkie wykryte.** Pierwsze przejście przepuściło
**dwa**, w tym to najważniejsze — przywrócenie starego hovera! Test klikał
skrzynię, więc była w ręce, a stara pętla hovera siedziała pod `if (!_carry)`
i nie miała jak zadziałać. Trzeba było dopisać przypadek z **pustymi rękami**.
To już czwarty raz z rzędu; drugie przejście jest obowiązkowe.

## 5-0bh. ZMIANY update47 (SKAFANDRY, POWIETRZE, GŁÓD, KOTY)

Lista gracza po pierwszym locie z kotem. Punkt o ekranie sortowania łupów
(*„jak nie ma miejsca w magazynie, przedmioty nie mogą znikać"*) gracz odłożył
na później — *„dobra, to sortowanie olej, narazie zrób resztę"* — i siedzi
dalej w §6.

### 1. KOT CHODZIŁ TYŁEM W JEDNĄ STRONĘ

`CrewMember.draw` odbija sprite lustrzanie przy `_facing === -1`, a `_facing`
1 znaczy „idzie w prawo". Grafika kota była narysowana **głową w lewo**, więc
klatka nieodbita — czyli ta używana przy chodzeniu w prawo — pokazywała kota
idącego tyłem. Poprawka to jedno `ctx.scale(-1, 1)` w `_genCat`: rysunek
patrzy teraz w prawo, a jedynym miejscem, które wie cokolwiek o kierunku,
zostaje `draw`.

**To dało się przetestować dopiero teraz.** Płótno w harnessie połyka każde
wywołanie, więc żaden test nie widział, gdzie ląduje łapa. Sekcja 146 podstawia
płótno, które **zapisuje łuki i śledzi transformację**, i pyta o jedną rzecz:
czy głowa jest po tej stronie, w którą zwierzę idzie.

### 2. IMIĘ KOTA BYŁO CZARNE NA CZARNYM

Tabliczka nad głową brała kolor korporacji, a kolor „korporacji" czarnego kota
to `#3a3a42` — na podkładce `rgba(7,8,15,0.75)`. Nowe `labelColor()`: swój w
swoim kolorze, wróg czerwony, **zwierzę w stałym jasnym bursztynie**, który nie
ma nic wspólnego z sierścią.

### 3. ZWIERZĘ NIE MA OŚMIU LUDZKICH UMIEJĘTNOŚCI

Konstruktor przechodził po `SKILL_DEFS` dla **każdego** ciała, więc kot miał
pilotaż, osłony i łatanie wyrw. Nie mógł ich użyć (`crewOperating` odsiewa
bestie od update45), ale panel pokazywał wszystkie osiem — a rząd pustych
ludzkich umiejętności to obietnica, której gra nie dotrzymuje. `BEAST_SKILLS`
= `['combat']` i tyle dostaje kot, pająk i szczur.

### 4. HEŁMY

Jeden `_helmet(ctx, cx, cy, r)` w `animation.js`, wołany z **każdego** stanu
załoganta i od kota. Nie sześć bąbli w sześciu miejscach — dokładnie tak
rozjechały się już kiedyś kolory wizjerów.

### 5. POWIETRZE W BUTLI — I SKASOWANY DRUGI REJESTR

Każde ciało ma własny zapas w **sekundach** (`SUIT_AIR.TANK`, wg rasy):
Pegasus 26 s, kot 16 s, reszta 8 s, **szczur i pająk 0** — wywietrzenie
modułu jest teraz sposobem na zabicie robactwa. Ładuje się samo tam, gdzie
jest czym oddychać.

`RoomOxygen` trzymał `_suffocateTimer` i `OXYGEN.DAMAGE_DELAY` — **trzy
sekundy taryfy ulgowej, które pokój prowadził za wszystkich stojących w
środku**. To jest ta sama wielkość co zapas powietrza człowieka, tylko w
drugim miejscu. Kopia pokoju **skasowana** razem z `DAMAGE_RATE`; zostało
jedno źródło i należy do człowieka. Wywietrzony moduł przestał być ścianą, a
stał się odliczaniem: można kogoś przez niego przeprowadzić i wyprowadzić.

### 6. GŁÓD DLA CAŁEJ ZAŁOGI

Jedna tabela `HUNGER` na wszystkie żołądki. Liczby kota **przeniesione** z
`CAT_TUNING` i `CAT_DEFS.hungerPerSec`, nie skopiowane — `CAT_TUNING` nie ma
już bloku `FOOD` ani progów. Człowiek opróżnia licznik w 40 minut lotu, czarny
kot w 20, jak dotąd.

Racje przestały być towarem na sprzedaż: `ration_pack` to **stos pięciu
posiłków** (`kind: 'food'`), głodny załogant sam sięga po jeden **tam, gdzie
stoi** — działonowy nie idzie na obiad do ładowni w środku walki — i zabiera
**jedną porcję**, nie całe pudełko. Kot dalej woli jajo pająka; człowiek jaja
nie zje. W sklepie bazy czwarta linia (3 CC za posiłek), w nowej bazie 10
porcji na półce na start. Ikonka menażki przy sprite'cie, obok pierścienia
wirusa i **nie na nim**, plus bar w panelu hover.

### 7. KOT DO KUPIENIA W BAZIE

`Base.adoptCat()` — 60 CC, ta sama ścieżka co `hireRecruit`, ale ląduje w
**zagrodzie**, nigdy w koszarach (to był bug z update45). Przycisk w MESS
przy zagrodach, gaśnie gdy nie ma miejsca albo pieniędzy.

### PRZY OKAZJI: SKASOWANY DRUGI PANEL UMIEJĘTNOŚCI

`UI.drawSkillPanel` rysował ten sam odczyt co `_drawSkillPanelLeft`, w innym
pudełku, innym układem — i **nikt go nie wołał**. Był martwy od czasu, gdy
zastąpił go panel przy rosterze, dlatego nigdy nie dostał barów powietrza i
głodu. Drugi egzemplarz ekranu rozjeżdża się tak samo jak drugi egzemplarz
liczby, a ten zdążył już pokazywać inny zestaw faktów o tym samym człowieku.

### PANEL HOVER ROŚNIE Z ZAWARTOŚCIĄ

`PH` było sztywne 210 — akurat na osiem rzędów umiejętności. Dwa nowe bary
wypchnęłyby dwa ostatnie poniżej ramki, a kot z jedną umiejętnością miałby
150 px pustego pudła. Wysokość liczy się teraz z liczby rzędów.

### PLIKI

`js/animation.js`, `js/base.js`, `js/basescreen.js`, `js/cargo.js`,
`js/crew.js`, `js/oxygen.js`, `js/ship.js`, `js/ui.js`,
`tests/run_tests.js`, `tests/smoke_draw.js`, `HANDOFF.md`

### TESTY

**2132 / 67 / 61** zielone. Nowe sekcje **146–150**: kierunek sprite'a i
hełmy (płótno zapisujące łuki), butla powietrza, żołądki całej załogi,
jednoliniowa karta umiejętności zwierzęcia, adopcja kota.

**31 celowych złamań, wszystkie wykryte** — ale dopiero za drugim podejściem.
Pierwsze przejście przepuściło „stary rozstaw linii sklepu": asercja mierzyła
przycisk względem **panelu** (524 px), a stary rozstaw stawiał go dokładnie na
524 — wewnątrz panelu, daleko poza **kartą** sklepu, w której miał być. Test
mierzy teraz kartę. To już trzeci raz z rzędu, gdy pierwsze przejście coś
przepuszcza; drugie podejście jest obowiązkowe.

## 5-0bi. ZMIANY update46 (CARGO RETROFIT SKASOWANY)

Mała paczka z jednym pytaniem gracza i jedną odpowiedzią.

Gracz: *„CARGO RETROFIT na co to, mamy już rozbudowę warehouse, to jest to
samo?"* — a po wyjaśnieniu, że to dwie różne rzeczy: *„nieważne, ogólnie nie
powinno tego być, statek ma swoje cargo i tak powinno pozostać"*.

**Skasowane w całości.** Ulepszenie, cena, `holdLvl`, `holdBonus()` i karta
na ekranie UPGRADES. Ładownia kadłuba to teraz **wyłącznie** to, co mówi jego
layout — wszędzie.

### PRZY OKAZJI ZAMKNĘŁO TO PRAWDZIWĄ PUŁAPKĘ

Szerokość ładowni liczyła się w **dwóch miejscach dwoma różnymi wzorami**:

```
basescreen.js  cargoCols + holdBonus()   ← ekran PACK HOLD
ship.js        cargoCols                  ← konstruktor Ship, BEZ bonusu
```

Kupiony retrofit dawał 6 kolumn na ekranie pakowania i 5 w kadłubie zbudowanym
gdziekolwiek indziej. Gracz tego nie widział, bo przepływ zawsze prowadził
przez PACK HOLD — ale to jest dokładnie ta sama choroba co cena reaktora
(update34), czas ładowania broni i statystyki broni: **dwie kopie tej samej
liczby zawsze się rozjadą.** Lekarstwo też to samo, które przepisuje §5:
skasować jeden rejestr, nie uzgadniać dwóch. Usunięcie ulepszenia usunęło
rozjazd — nie trzeba było go naprawiać.

### ZWROT PIENIĘDZY

Kto zdążył kupić retrofit, dostaje CC z powrotem **raz**, przy pierwszym
odczycie bazy (100 + poziom×110, czyli 100 za pierwszy i 310 za dwa).
`holdLvl` jest przy tym **kasowane**, nie zerowane, więc zwrot nie może
polecieć drugi raz. Nikt nie ma być stratny za coś, co usunęliśmy.

### PLIKI

`js/base.js`, `js/basescreen.js`, `tests/run_tests.js`, `tests/smoke_draw.js`,
`HANDOFF.md`

### TESTY

**2070 / 64 / 61** zielone (sekcja 41 przepisana z „retrofit działa" na
„retrofitu nie ma, a szerokość ma jedno źródło").
**5 celowych złamań, wszystkie wykryte** — jedno trzeba było napisać od nowa,
bo pierwsza wersja usuwała pole, którego już nie ma, więc niczego nie psuła.
Prawdziwy test to rozjechanie szerokości o jeden: łapane natychmiast.

## 5-0bj. ZMIANY update45 (KOTY KSIĘŻYCOWE)

Trzecia część uzgodnionej trójki (43 kapitan → 44 poprawki → 45 koty).
Zagrody stanęły puste w update44; teraz mają lokatorów.

### DECYZJA GRACZA, KTÓRA UKSZTAŁTOWAŁA CAŁOŚĆ

Pytanie brzmiało: **co kot robi, kiedy nie ma szczurów** — a nie ma ich przez
większość gry (próg 50% zapełnienia ładowni, maks. 22% szansy na skok). Kot,
który tylko poluje, siedziałby bezczynnie całe kontrakty.
Gracz wybrał: **czuwa przy rannym.** Kot siada przy powalonym i zegar
wykrwawiania idzie wolniej (`VIGIL_FACTOR 0.6`, czyli 40 s robi się ~66).
Nie leczy — jest kotem — ale ciało, przy którym ktoś jest, to ciało, które
ktoś zauważy. To daje mu robotę w **każdej** walce.

### CO ROBI KOT

Lista priorytetów w `Ship.petTick()`, po kolei:
1. dokończ posiłek → 2. poluj, jeśli są szczury → 3. **siądź przy rannym** →
4. jesteś głodny, znajdź coś → 5. włócz się.
Rozkaz gracza (klik w moduł) bije wszystko, dopóki kot nie dojdzie.

- **Dwa koty, prawdziwy wybór:** czarny (26 HP, 5,0 obrażeń, głodnieje 1/12 s)
  i rudy (22 HP, 3,5 obrażeń, 1/18 s). Mocniejszy je szybciej.
- **`isBeast` obejmuje teraz kota.** Nie obsadza konsol, nie gasi, nie nosi
  noszy, nie liczy się jako ręka. Do tego **`crewOperating()` odfiltrowuje
  bestie** — szczur był wrogą załogą, więc odpadał na filtrze strony; kot jest
  NASZ i był pierwszą bestią, która mogła dojść do konsoli.
- **Głód 0–100.** Poniżej 40 poluje serio i je jaja; poniżej 12 leci
  ostrzeżenie; na zerze traci 1 HP na 6 s. Śmierć z głodu to zbocze, nie
  urwisko — czarny kot ma od zera jakieś 2,5 minuty.
- **Jaja przed racjami:** zjedzone jajo to walka, która się nie odbyła, a
  gracz woli stracić jajo niż rację, na którą liczył.
- **Na wraku wyczuwa jaja o jeden moduł dalej** — ujawnia je, ale ich NIE
  przyspiesza. Wiedzieć to nie to samo co ruszyć.
- **Odstrasza, nie kasuje:** kot na pokładzie zdejmuje 0,12 z rzutu na
  szczury przy skoku i **nie może zejść do zera**.
- **Ginie naprawdę** i ma **własny nagrobek** z własną drabiną, liczoną z
  tego, co złapał (`paw / ratter / hunter / legend`) i rysowaną jako łapa
  w kamieniu. Na ludzkiej drabinie każdy kot dostawałby najniższy krzyż
  w całej alei, bo nie wygrywa bitew i nie opanowuje umiejętności.
- **Skąd się bierze:** dwa eventy — pasażer na gapę w ładowni (za darmo)
  i ratownica z portu (40 CC). Nie ma go w sklepie.
- **Jeden na kadłub**, choćby zagród było więcej: drugi kot tylko połowiłby
  robotę pierwszego, a decyzja, którą ma tworzyć zagroda, brzmi „brać czy nie".

### DWA BŁĘDY ZNALEZIONE PRZY OKAZJI

**1. `hp` było ustawiane PRZED `maxHp`** i domyślało się do płaskiej setki.
Niewidoczne, dopóki każdy miał 100 maks. — i natychmiast widoczne, gdy na
pokład wszedł kot z własnym maksimum: dostawał **100/26**, czyli ponad własny
sufit, i głodował cztery razy dłużej, niż mówią liczby. Kolejność odwrócona,
a `hp` domyśla się do `maxHp`.

**2. Kot wchodził do koszar jako najemny człowiek.** Załoga bankowana przy
dokowaniu filtruje `c.isPlayer && !c.dead`, a kot przechodzi oba warunki.
Dokładnie ten sam błąd, co wrodzy abordażyści w update42, tylko w futrze.
**To był jedyny punkt, którego pierwszy przebieg łamania nie złapał** — test
dopisany.

### PLIKI

`js/animation.js`, `js/base.js`, `js/basescreen.js`, `js/crew.js`,
`js/game.js`, `js/map.js`, `js/ship.js`, `tests/run_tests.js`,
`tests/smoke_draw.js`, `HANDOFF.md`

### TESTY

**2063 / 64 / 61** zielone (nowe sekcje 143–145).
**18 celowych złamań, wszystkie wykryte** (jedno dopiero po dopisaniu testu).

## 5-0bk. ZMIANY update44 (raport gracza: exploit z osłonami, mesa jako budynek)

Pierwsza partia po zagraniu w update43. Gracz: *„na pewno to, że exp jest za
załadowanie osłon a nie za stracenie — teraz podczas postoju pomiędzy walkami
można włączać i wyłączać osłony i nabijać exp"*.

### A. XP Z OSŁON DAŁO SIĘ FARMIĆ W CISZY

Miał rację i to był prawdziwy exploit. XP leciało za **każde** doładowanie
warstwy, a odebranie modułowi mocy **zdejmuje warstwy** — więc wystarczyło
stanąć w pustym systemie i pstrykać zasilaniem osłon.

Nowe `_shieldDebt`: `hitShield()` zapisuje warstwę jako **należną**, a wypłata
idzie wyłącznie z tego długu. Przełączanie mocy nadal odbudowuje bańkę —
po prostu nikogo już niczego nie uczy. `prechargeShields()` zeruje dług, bo
bańka zbita w poprzedniej walce nie jest lekcją należną w tej.

Ta sama choroba co zawsze w tym projekcie: **nagroda była przypięta do
SKUTKU (warstwa wróciła), a nie do PRZYCZYNY (ktoś ją zestrzelił).**

### B. MESA TO BUDYNEK, NIE ZAKUP

Gracz: *„mesa nie powinna mieć upgrade tam, powinno być tak jak reszta
budynków w oknie Upgrades, ponadto na początku jest lev 1 od razu tak jak
inne budynki i jest miejsce dla 1 kapitana"*.

Miał rację co do wzorca: mesa była **jedynym budynkiem w bazie, który działał
inaczej niż wszystkie pozostałe** — trzeba ją było najpierw znaleźć na własnej
zakładce i kupić. Teraz stoi na poziomie I od pierwszego dnia z jedną koją,
a koje II–IV (**250 / 400 / 600 CC**) kupuje się na zakładce UPGRADES, w tej
samej drabinie co magazyn, koszary, hangar i ładownia.
`buyMess()` został jako alias do `buyUpgrade('mess')` — jedna drabina, jedno
wywołanie. **Stary zapis z update43 (messLvl 0) jest migrowany w górę**, żeby
nikt nie płacił za coś, co nowa gra dostaje za darmo.

### C. ZAGRODY DLA ZWIERZĄT

Gracz: *„dodaj też od razu miejsce dla kotów, 2 kwadraty wystarczą"*.
Baza ma **2 zagrody od początku** (kolejne po 200 + poziom×200 CC na tej samej
drabinie), widoczne na dole ekranu mesy jako dwa puste kwadraty.
**Celowo NIE są to koje:** kot, który musiałby konkurować z piątym strzelcem
o łóżko, nigdy by nie poleciał, a cały sens zwierzaka polega na tym, że
zabranie go ma być wyborem, a nie oczywistym „nie".
Puste do update45 — miejsce jest prawdziwe i opłacone, więc gracz ma je widzieć.

### PLIKI

`js/base.js`, `js/basescreen.js`, `js/ship.js`, `js/systems.js`,
`tests/run_tests.js`, `tests/smoke_draw.js`, `tests/browser_test.js`,
`HANDOFF.md`

### TESTY

**2022 / 61 / 61** zielone (nowa sekcja 142, przepisana 138).
**9 celowych złamań, wszystkie wykryte** — po tym, jak pierwszy przebieg
wypuścił trzy:

- test exploitu **nie łapał samego exploitu**: operator odchodził od konsoli
  w trakcie przełączania mocy, więc na ZEPSUTEJ wersji też nic nie zarabiał.
  Teraz jest sadzany co iterację, a osobna asercja pilnuje, że przełączanie
  naprawdę wywołało doładowania — inaczej sekcja niczego nie dowodzi;
- test starego długu robił `prechargeShields()` i kończył — a przy pełnej
  bańce nie ma doładowania, więc i tak nic by nie wypłaciło. Teraz po
  rozpoczęciu „nowej walki" wymuszane jest doładowanie bez trafienia;
- złamanie „mesa startuje niezbudowana" jest **z definicji niewidoczne**,
  bo migracja podnosi zero przy pierwszym odczycie. Wyrzucone ze skryptu
  jako bezsensowne, nie odpuszczone jako dziura.

## 5-0bl. ZMIANY update43 (KAPITAN, mesa, XP z konsoli, korporacje wrogów)

Pierwsza część dużej trójki uzgodnionej z graczem (43 kapitan → 44 plansza CPU
i karma → 45 koty). Poza kapitanem paczka naprawia dwie rzeczy, które wyszły
dopiero przy MIERZENIU, a nie przy czytaniu kodu.

---

### A. BONUS DAWAŁA CAŁA OBSADA MODUŁU, NIE OPERATOR PRZY KONSOLI

Gracz był przekonany, że premię do modułu daje wyłącznie ten przy konsoli.
Kod robił coś innego: **sumował po WSZYSTKICH w pomieszczeniu.**

```
ship.js  weaponCrewBonusFor()  → crewInRoom(room.id).reduce(...)
ship.js  evasion               → reduce po crewOperating (pilotaż i silniki)
systems.js _updateShields      → this.crew.reduce(...)
```

Trzech mistrzów w wieży dawało 0.9, ucinane cappem 0.75 — a cap istnieje
wyłącznie po to, żeby nie wyszło `dt / 0` i nie zabiło klatki. **Najmocniejszym
ruchem w grze było więc upchnięcie trzech ludzi w jednym module**, czego nikt
nie zaprojektował i czego gracz nie mógł zobaczyć.

Nowe `Ship.consoleOperator(roomId)` — kto stoi na slocie 0. Zwraca `null` dla
pustego i dla **spornego** modułu, dokładnie jak `crewOperating()`.
Premia i **XP** idą teraz przez nie: pracuje jeden, uczy się jeden.
Pozostali dwaj nadal biją abordażystów, gaszą i naprawiają — po prostu nie
przyspieszają działa.

- maksymalna premia z załogi: **75% → 30%**; walka jest dłuższa;
- **cap 75% ZOSTAJE** jako zabezpieczenie przed `dt / 0` — nie usuwać;
- `assignStations` sadza na posterunku **najlepszego w danym skillu**
  (korporacja została tylko tiebreakiem), inaczej przy konsoli lądował
  Phoenix-żółtodziób, a mistrz stał obok i nie robił nic.

### B. XP_RATES — OSIEM LICZB W JEDNYM MIEJSCU

Stawki XP siedziały jako gołe literały w sześciu plikach. Zmierzone
symulacją prawdziwej walki różniły się **o trzy rzędy wielkości**:

| skill | było | do mistrzostwa | jest |
|---|---|---|---|
| weapons | 8 / strzał | **1,2 walki** | **1,0** |
| piloting | 10 / unik | 3,3 | 8 |
| repair | 0,5 / s | 4,4 | 0,25 |
| engines | 10 / unik | 6,7 | 8 |
| shields | 6 / warstwę | 8,3 | 8 |
| firefight | 2,5 / s | 14 | 5,0 |
| breach | 0,4 / s | **~500 s łatania** | **6,0** |
| combat | 10 / cios | ~20 ciosów | 10 |

Kanonier osiągał mistrzostwo **w jednej walce**, a `breach` był nieosiągalny.
Cel nowych stawek: mistrzostwo ≈ 8–10 walk dedykowanej pracy, czyli limit
„3 mistrzostwa na osobę" wreszcie zaczyna być wyborem, a nie formalnością.
**Uwaga na sprzężenie zwrotne przy pilotażu i silnikach:** uniki dają XP, XP
podnosi unik, wyższy unik daje więcej uników — dlatego skalowanie liniowe
tych dwóch nie działa i trzeba je mierzyć, nie liczyć.
Sekcja testów 137 czyta `js/` i **odrzuca każdy goły literał w `addXP`**.

### C. KAPITAN (`js/commander.js`)

**Nie jest jednostką na przekroju.** Nie ma HP, nie chodzi, nie obsadza
konsoli, nie da się go zastrzelić ani udusić. Należy do WYPRAWY, nie do
modułu — i dlatego jest osobnym rekordem, a nie kolejnym `CrewMember`:
`ship.crew` to lista ciał na pokładzie i każdy filtr w grze tak ją czyta.

- **`addXP()` zwraca teraz KWOTĘ FAKTYCZNIE PRZYZNANĄ** (było: boolean,
  którego nikt nie czytał). Kapitan kopiuje dokładnie tę liczbę — po mnożniku
  korporacji, zero dla mistrza. **Żadnego ukrytego XP dla mistrzów:** załoga
  z trzema mistrzostwami przestaje go uczyć i to jest powód, żeby brać świeżych.
- Karmią go **tylko nasi ludzie**: wrogi abordażysta w `ship.crew` i szczur nie.
- Poziomy **1–8**, progi `COMMANDER_LEVEL_XP` rosnące (300…5500).
  **8 to sufit** — ostatni rząd planszy CPU otwiera się właśnie tam i wyżej
  nic by się nie odblokowywało. Test asertuje literalną ósemkę, nie stałą.
- **Premie korporacyjne** tylko dla załogi TEJ SAMEJ korporacji, per poziom:
  Aquarius +1% HP / +1% ruchu, Pegasus +0,5% / +1,5%, Terra +1% HP /
  +2% naprawy, Phoenix +0,5% HP / +1% wręcz.
- `Commander.reseatMaxHp()` — maks. HP to liczba ZAPISANA, więc bonus jest
  osadzany w kilku momentach (start, wczytanie), a nie liczony co klatkę.
  **Zachowuje PROCENT zdrowia, nie leczy**; powalony nie wstaje.
- Ginie razem ze statkiem (`_onLose`). Baza, inni kapitanowie i półka zostają.
  **Nie ma końca gry.** Kapsuła ratunkowa dopiero w update44.

### D. MESA KAPITANA (zakładka MESS w bazie)

Poziomy I–IV za **150 / 250 / 400 / 600 CC**, jedna koja na poziom.
Promocja załoganta z **opanowanym** skillem kosztuje **100 CC** i jest
nieodwracalna: człowiek **wychodzi z koszar i nie powstaje jego kopia**.
Karta kandydata mówi wprost, które mistrzostwa baza traci — koszt, który
odkrywa się po fakcie, to pułapka.

Kapitan na wyprawie **nadal zajmuje koję** (`away: true`).
`Base.launch()` przyjmuje i **zwraca `commanderId`** — bez tego kapitan
zostawał w bazie mimo zaznaczenia (złapane dopiero testem w przeglądarce).

Panel bazy ma **386 px wysokości** i to jest cały budżet: karta kapitana
mieści się w 62 px, żeby czwarta koja za 600 CC nie rysowała się poza
panelem. W HUD walki kapitan to jeden pasek nad listą załogi (imię, poziom,
postęp do awansu) — **żadnego nowego panelu w walce**.

### E. WROGOWIE MAJĄ KORPORACJE

`makeEnemyCrew()` nie podawał rasy, więc konstruktor ustawiał
`race = 'hostile'` — klucz, którego **nie ma w `CORP_DEFS`**. Każde pytanie
o korporację wroga po cichu zwracało `undefined`. Nieszkodliwe, dopóki nikt
nie pytał — i przestające być nieszkodliwe w chwili, gdy wrogi kapitan ma
płacić premię swojej korporacji.

`ENEMY_CORP_MIX` per kadłub, celowo nierówny: raider to statek abordażowy
i wystawia noże Phoenixa, gunship opiera się na inżynierach Terry, stacja
bossa trzyma Aquariusa od kontroli uszkodzeń. **To jest realna zmiana
trudności i taka ma być:** wrogi Pegasus nie dusi się przy odcięciu
powietrza, Aquarius nie parzy się przy gaszeniu, a Terra dokłada swojemu
modułowi jednostkę mocy samym staniem w nim. Dlatego Pegasus jest rzadki.
Mundur zostaje czerwony — `suitColor()` patrzy na `isPlayer`, nie na rasę.

### PLIKI

`js/commander.js` (NOWY), `js/base.js`, `js/basescreen.js`, `js/boss.js`,
`js/breach.js`, `js/combat.js`, `js/crew.js`, `js/game.js`, `js/renderer.js`,
`js/ship.js`, `js/systems.js`, `index.html`, `tests/harness.js`,
`tests/run_tests.js`, `tests/smoke_draw.js`, `tests/browser_test.js`,
`HANDOFF.md`

### TESTY

**2006 / 60 / 60** zielone (nowe sekcje 136–141).
**27 celowych złamań kodu, wszystkie wykryte** — po tym, jak pierwszy przebieg
wypuścił pięć i wymusił poprawki:

- pułap poziomu kapitana był asertowany **przeciwko własnej stałej**
  (`c2.level === Commander.MAX_LEVEL`), czyli przechodził przy każdej jej
  wartości → test wypisuje teraz literalną ósemkę;
- **nikt nigdy nie próbował przepełnić mesy** → doszedł przypadek „mesa pełna,
  promocja odrzucona i NIC się nie zmienia";
- test rankingu do konsoli miał **dwóch ludzi na dwa posterunki**, więc każdy
  i tak gdzieś siadał i wersja zepsuta przechodziła → trzeci załogant zajmuje
  kokpit, a mistrz i żółtodziób konkurują o TO SAMO działo;
- dwa złamania były źle napisane (jedno nie zmieniało zachowania, drugie
  celowało w zły zestaw) — poprawione, nie odpuszczone.

## 5-0bm. ZMIANY update42 (raport z testów gracza: zaraza, ranni, dźwięk, abordaż)

Gracz przeszedł 37-punktową listę kontrolną: **29 działa, 8 błędów**. Ta paczka
zamyka wszystkie osiem plus balans i decyzje projektowe, które przy okazji podał.

---

### A. ZARAZA TRUPIA — dwa bugi, które się wzajemnie maskowały (T-04)

Gracz: *„jak ciało się rozkłada i jakiś załogant przyjdzie do przedziału to
wyrzuca ciało gnijące… niech zaraza się rozprzestrzenia po wszystkich modułach,
wentylacja na statku jest… jak ciało się wyrzuca to drzwi muszą być otwarte,
teraz wyrzuca przez zamknięte"*.

Miał rację w każdym punkcie, a przyczyna była podwójna:

**1. Rozkład nie był zegarem, tylko licznikiem walk.** `markCombatStart()`
ustawiało `decaying` dopiero na starcie **następnej bitwy**. Do tego czasu
dowolny załogant wchodzący do modułu podnosił zwłoki i wypychał je przez
**zamkniętą** śluzę. Te dwie rzeczy razem znaczyły, że **cały podsystem zarazy
nie odpalił ani razu w prawdziwej grze**.

Teraz: `Ship.DECAY_SECONDS = 40` — ciało zostawione na pokładzie zaczyna gnić
samo, bez żadnej walki.

**2. Zwłok nie da się wypchnąć przez zamkniętą śluzę.** Nikt ich nawet nie
podnosi, jeśli na statku nie ma **żadnej otwartej śluzy** (`hasOpenAirlock()`),
a przy wyrzuceniu szukana jest tylko śluza z `mode === 'open'`. Jeżeli gracz
zamknie wszystko w trakcie transportu, niosący czeka `CORPSE_HOLD_SECONDS = 6`
i odkłada ciało — nie stoi z nim w nieskończoność.

**3. Otwarcie śluzy jest teraz ROZKAZEM.** Zbieranie zwłok było czysto
oportunistyczne (ciało podnosił tylko ktoś, kto już stał w tym module), więc
trup w przedziale, przez który nikt nie chodzi, gnił wiecznie niezależnie od
tego, co gracz zrobił. Gnijące ciało + otwarta śluza = wysyłamy najbliższą wolną
rękę, żeby je wyniosła.

**4. Zaraza idzie wentylacją.** Infekcja sięgała wyłącznie
`crewInRoom(body.roomId)` — jedne drzwi dalej byłeś nietykalny. Statek ma jeden
obieg powietrza:

| gdzie | szansa/s |
|---|---|
| ten sam moduł co ciało | `PLAGUE_RATE_ROOM` = 0.05 |
| **reszta statku** (jeśli life support pracuje) | `PLAGUE_RATE_VENT` = 0.008 |
| reszta statku przy wyłączonym O₂ | 0 |

Skala rośnie z liczbą gnijących ciał. **Odcięcie tlenu zatrzymuje epidemię** —
za oczywistą cenę. To jest nowa, prawdziwa decyzja taktyczna.

---

### B. RANNY TO NIE MARTWY (T-05)

Gracz: *„nie każdy statek ma medbay, teraz ranni są leczeni w danym module
którym są ranni"*.

FIELD AID było opakowane w `if (!medUsable)` — czyli mechanika **wyłączała się
na całym statku**, gdy tylko gdziekolwiek istniał sprawny medbay. Ranny dwa
pokłady dalej nie dostawał nic, dopóki ktoś fizycznie go nie przyniósł, a
większość kadłubów w ogóle nie ma medbayu.

Teraz opatrunek polowy działa **zawsze**: kolega w tym samym module leczy
`Ship.FIELD_AID_HPS = 2.2` hp/s tam, gdzie ranny leży. Medbay nadal jest ~3×
szybszy i nadal to tam noszą go nosze.

---

### C. RANNY WRÓG BLOKOWAŁ KONIEC WALKI (T-15) — soft-lock

Gracz: *„jak zostanie ranny przeciwnik to walka się nie kończy, chyba że rozwalę
do końca statek przeciwnika"*.

Warunek „załoga wroga wybita" brzmiał `!c.isPlayer && !c.dead`. Załogant, który
**padł** (`down`), ma hp 1 i `state === 'injured'` — nie jest martwy. Więc
ostatni obrońca, który padł zamiast zginąć, blokował ofertę wraku i czyszczenie
derelikta na zawsze. Zostawało tylko zmielić kadłub działami.

**Dwie poprawki:**

1. Warunek to teraz `c.alive` — getter, który już wcześniej znaczył „stoi na
   nogach" (wyklucza `injured` i `dying`). Walka kończy się, gdy nikt nie stoi.
2. Zgodnie z propozycją gracza (*„np 40s po tym jak nie uratowany to ginie"*):
   `Ship.BLEEDOUT_SECONDS = 40`. Padnięcie to teraz odliczanie — dotrzyj do
   niego albo go stracisz. Komunikat mówi wprost ile zostało.

---

### D. DŹWIĘK: suwak muzyki i MUTE (T-06, T-07, T-08)

Gracz: *„sound effect działa, ale music nie… i jak dam f5 to się mutuje"*.

**1. Suwak muzyki był martwy.** `playMusic()` i `stopMusic()` wpisywały do
`musicGain` **literał 0.35**. Każda zmiana trybu (menu → mapa → walka → boss,
kilkanaście miejsc wywołania) kasowała poziom gracza. **Lustro `getVolumes()`
dalej zwracało to, co ustawił** — więc suwak wyglądał na działający i nie
działał ani przez chwilę. Dodatkowo zaplanowany `linearRampToValueAtTime(0)` z
wyciszania nigdy nie był anulowany, więc w trakcie fade suwak był bezwładny.

Teraz `_restoreMusicGain()` anuluje harmonogram i przywraca `_vol.music`.
Doszło `Audio.getNodeLevels()` — **testy sprawdzają węzeł gain, nie lustro**,
bo lustro nigdy się nie myliło; mylił się dźwięk.

**2. MUTE był gumką, nie przełącznikiem.** Wpisywał `masterVolume = 0` prosto
do save'a: wybrany poziom ginął, zero przeżywało F5 (**gra wstawała niema**),
a UNMUTE zgadywał 0.8. Teraz `muted` to własna flaga; poziom zostaje pod spodem.

**3. Suwak pisał do localStorage 60×/s** mimo komentarza twierdzącego, że
zapisuje raz przy puszczeniu. Doszło `Save.setSettingLive()`; `saveSettings()`
leci raz, przy puszczeniu.

**4. OPEN ALL / CLOSE ALL były bezgłośne.** Wpisywały `d.mode` ręcznie zamiast
przez `Door.toggle()` — jedyne miejsce, które gra `doorMove()`. Teraz dźwięk
leci, gdy naprawdę coś się rusza (ponowne otwarcie otwartych jest ciche).

---

### E. PASEK OSŁON WROGA (T-10)

Gracz: *„osłona jak jest naładowana to kawałek jej ścina z tyłu u przeciwnika"*.

Rząd bąbelków wisiał na zaszytym `_W - 150` i rósł **w prawo**, podczas gdy cała
reszta panelu wroga jest kotwiczona do prawej. Przy 6 warstwach szósty bąbelek
zaczynał się na x=1270 przy kanwie 1280, a pierścień ładowania (`r + 3`,
grubość 2.5) ścinał się jeszcze wcześniej. Teraz kotwiczona jest **prawa
krawędź** rzędu i rośnie on w lewo — mieści się przy dowolnej liczbie warstw.

---

### F. SKOK BEZ He2 (T-19)

Gracz: *„skok przechodzi"*. Gwardia w `_travelTo` była poprawna — ale:

1. **Nie mówiła nic.** Odbijała cicho w latarnię ratunkową, więc z kokpitu
   wyglądało to tak, jakby skok po prostu się udał. Teraz jest komunikat.
2. **Latarnia była kranem z paliwem.** `_maybeSOS()` otwierało się przy KAŻDEJ
   próbie, bez limitu: kliknij węzeł, wyżebraj 1–2 He2, kliknij znowu. He2 było
   jedynym zasobem bez zębów. Teraz latarnia odpowiada **raz na węzeł**
   (`_sosNode`, kasowane przy każdej nowej mapie sektora). Ponowna oferta po
   nieopłacalnej transakcji leci przez `_maybeSOS(true)` i nie liczy się.

---

### G. ABORDAŻ — paczka błędów

**1. Ikony mojej załogi znikały.** Panel to było płaskie
`playerShip.crew.forEach`. Drużyna abordażowa jest **przenoszona** z
`playerShip.crew` do `enemyShip.crew` w chwili odbicia — więc znikała z HUD-u na
całą walkę, po którą ją wysłałeś: bez portretu, bez paska HP, bez możliwości
kliknięcia. Jednocześnie **wrodzy abordażyści stojący na TWOIM pokładzie
dostawali własne wiersze**.

Nowy `Renderer.crewRoster(state)`: nasi na naszym kadłubie + nasi na ich,
oflagowani `_awayTeam` (pomarańczowa ramka i szewron `»`). Strefy klikalne noszą
`crewRef`, a nie indeks do `_playerShip.crew`.

**2. Moi leczyli wrogów.** `bodiesInRoom()` nie miało filtra strony — twój
medbay stawiał na nogi wroga, który cię abordażował, z zielonym powiadomieniem
„back on their feet!", a twoi ludzie nosili go tam na noszach. Doszedł filtr
strony (domyślnie włączony) plus filtry w dyspozytorni ratunkowej, apteczce
(`_unpackCargo('heal')`) i klinice stacji (płaciłeś 12 CC za wyleczenie szczura).

**3. Wrogowie przechodzili na moją stronę.** Nic **nigdy** nie usuwało wrogiej
załogi z `_playerShip.crew`. Ocalały abordażysta zostawał tam na zawsze: dostawał
wiersz w rosterze, dawał się zaznaczyć i rozkazywać, był **wpisywany do koszar
przy dokowaniu** i zapisywany do save'a. Nowe `_purgeIntruders()` woła się z
`_recoverBoarders()` (a to leci z każdego wyjścia z walki). **Bestie zostają** —
pająk czy szczur na pokładzie to plaga i ma przetrwać.

**4. Klikanie wrogiego intruza.** `_crewUnderCursor` łapało dowolne żywe ciało w
`_playerShip.crew`, więc wroga dało się zaznaczyć, dodać do grupy i **wodzić po
własnym statku**. Teraz `c.isPlayer`; to samo w zaznaczaniu ramką i „zaznacz
wszystkich".

**5. Walki i trupy w drzwiach.** `roomId` nigdy nie było czyszczone, gdy ktoś
wyszedł **poza wszystkie prostokąty modułów** — a szyb windy (28 px) to
prawdziwa podłoga, która do żadnego modułu nie należy. Czekając na kabinę
abordażysta trzymał nieaktualne id modułu, który opuścił, więc:

- melee dobierało go przez ścianę,
- bójka kasowała mu przejazd windą, więc nigdy nie odjeżdżał,
- gdy przegrał, zwłoki leżały w szybie, a `bodiesInRoom` dalej raportowało go
  w sąsiednim module.

Nowe pole `c.inRoom`, ustawiane **przed** `c.update()` (melee sądzi po pozycji z
TEJ klatki, a na pierwszej klatce na pokładzie nie ma żadnej poprzedniej) i
jeszcze raz po. `crewInRoom` / `occupantsOf` / `bodiesInRoom` / melee / ogień —
wszystko wymaga fizycznej obecności w module. Do tego
`CrewMember.MELEE_INSET = 18`: kto zaczyna machać, jest wciągany do środka
modułu, więc bójki i zwłoki nie siedzą na krawędzi ściany.

---

### H. BALANS

**Dwa moduły broni = dwie bronie.** Druga broń była bramkowana
`elite || sector >= 2`, więc Sobek w sektorze 1 latał z dwoma modułami, czterema
załogantami i **jednym** laserem — a `assignStations` sadzało kanoniera przy
pustej konsoli na całą walkę. Teraz każda wnęka dostaje broń; sektor i elita
decydują tylko **jak dobrą**.

**Sonda zwiadowcza: 55 → 35 CC.** *„cena pewnie trochę za duża"*.

---

### I. DECYZJA GRACZA: ogień przez zamknięte drzwi

Gracz: *„tak, ale nie tak łatwo jak z otwartymi, później dodamy mocniejsze
drzwi parę lev"*.

Ogień skakał do **dowolnego** sąsiedniego modułu niezależnie od drzwi, więc
uszczelnienie płonącego modułu nie dawało nic i przyciski drzwi były przy pożarze
dekoracją. `Ship.getOpenAdjacentRooms()` istniało od dawna i **nie miało ani
jednego wywołania**.

Nowe `Ship.adjacentThermal(roomId)` zwraca sąsiadów wraz ze stanem przejścia,
a każde przejście jest losowane osobno:

```
otwarte drzwi:  SPREAD_CHANCE                       = 0.60
zamknięte:      SPREAD_CHANCE * CLOSED_DOOR_FACTOR  = 0.12
```

Przy przebiciu leci inny komunikat („Fire burned THROUGH a sealed door!").
`CLOSED_DOOR_FACTOR` jest gotowym haczykiem pod pancerne drzwi z poziomami.

---

### PLIKI

`js/audio.js`, `js/base.js`, `js/crew.js`, `js/fire.js`, `js/game.js`,
`js/renderer.js`, `js/save.js`, `js/ship.js`, `js/station.js`, `js/ui.js`,
`tests/harness.js`, `tests/run_tests.js`, `HANDOFF.md`

### TESTY

**1878 / 32 / 45** zielone. Nowe sekcje 121–135. **28 celowych złamań kodu,
wszystkie wykryte** — w tym cztery, które za pierwszym razem przeszły
niezauważone i wymagały wzmocnienia testów:

- test wołał `_purgeIntruders()` **bezpośrednio**, więc wyłączenie jedynego
  miejsca wywołania niczego nie zmieniało → test idzie teraz przez
  `_recoverBoarders()`;
- w teście zwłok **nikt nie stał w module z ciałem**, więc reguły podnoszenia w
  ogóle nie były aktywne → doszedł załogant stojący nad ciałem;
- dwie gwardie (podnoszenie i wyrzucanie) **maskowały się nawzajem** — złamanie
  jednej było niewidoczne, bo druga i tak blokowała → rozdzielone na osobne
  przypadki, z wymuszonym niesieniem ciała pod zamkniętą śluzę;
- `_stepInsideRoom` testowany był na przeciwniku ustawionym **już w środku**
  modułu → teraz startuje dokładnie na płaszczyźnie drzwi.


## 5-0bn. ZMIANY update41 (JEDNA SIATKA KADŁUBOWA, kafle silnika i dziobu)

Przygotowanie pod grafikę. Użytkownik zaczął robić assety i natychmiast trafił
w sedno: **„wszystkie moduły na wszystkich statkach powinny mieć te same
rozmiary aby było łatwo i uniwersalne"**. Miał rację — i było gorzej, niż widać
z zewnątrz.

**1. BYŁY TRZY ROZMIARY MODUŁU, NIE JEDEN.** `80×72` (scout, hauler i wszystkie
trzy kadłuby wroga), `96×80` (frigate) i `96×60` (stacja bossa) — do tego trzy
różne skoki pokładu (80, 90, 66). Powód: **każdy layout miał wpisane własne
piksele na sztywno**, więc rozjeżdżały się po jednym kadłubie na raz. To robiło
wspólny zestaw grafik niemożliwym: kafel podłogi wycięty pod scouta ma zły
rozmiar na frigate i zły kształt na stacji.

**2. LAYOUTY SĄ TERAZ W WSPÓŁRZĘDNYCH SIATKI.** Nowe `HULL_GRID` + `buildHull()`:
```js
MODULE_W 80 · MODULE_H 72 · DECK_GAP 8 → DECK_PITCH 80
SHAFT_W 28 · MARGIN 14 · ENGINE_W 48 · PROW_W 40 · WALK_FRAC 0.65
```
Kadłub deklaruje `originX/originY`, `decks`, `shaftAfter: [0]` i listę pokoi jako
`{ col, row }`. Piksele **wylicza `buildHull`**, a nie człowiek. Dodanie kadłuba to
wypisanie kratek; zmiana rozmiaru modułu to zmiana JEDNEJ liczby i wszystko —
każde drzwi, każdy przystanek windy, każde miejsce przy konsoli — idzie za nią.
`rooms`/`elevators` wychodzą w tym samym kształcie co wcześniej, więc reszta
silnika nie wymagała ani jednej zmiany.

**3. PRZYSTANKI WIND SĄ WYLICZANE.** Były wpisane ręcznie per kadłub
(`floors:[217, 137]`) — i dlatego kabina na stacji bossa wystawała przez dach.
Teraz każdy szyb zatrzymuje się na linii chodzenia **każdego** pokładu, z tej samej
formuły co reszta.

**4. STACJA BOSSA: 6 pokładów `96×60` → 5 pokładów `80×72`.** Dziesięć
pomieszczeń, dwie kolumny, jeden szyb — wysokość praktycznie ta sama (392 vs 390),
kadłub węższy. **Ten jeden kadłub był jedynym powodem, dla którego istniał trzeci
rozmiar modułu.**

**5. KAFLE ZEWNĘTRZNE — `engineSlots()` i `prowSlots()`.** Kadłub składa się jak
LEGO, jeden rząd na pokład:
```
[silnik][moduł][moduł][szyb][moduł][moduł][dziób]
```
Silnik to **jeden kafel powtarzany na każdym pokładzie** (48×72). Dziób **nie** —
nos jest zbieżny, więc kafel zależy od wysokości kadłuba: 1 pokład → `solo`,
2 → `top`/`bot`, 3 → `top`/`mid`/`bot`. Każdy slot niesie `slice`, `decks` i `flip`
(kadłub wroga jest lustrzany — rufa po drugiej stronie).
**Stacja nie ma ani jednego ani drugiego** — Apophis nigdzie nie leci, i to
dlatego zestaw grafik nie potrzebuje osobnych kafli dla stacji.

**6. `weaponX` SKASOWANE.** Siedem wpisów, **zero odczytów** w całym `js/`.
Kolejny martwy rekwizyt z tej samej rodziny co `MODULE_DEFS` z update40.

**Testy:** `run_tests.js` **1657** (nowe sekcje 119–120), `smoke_draw.js` 32,
`browser_test.js` 45. **11 celowych psuć, wszystkie złapane.** Sprawdzone też
wizualnie: frigate (3 pokłady, 2 szyby) i Apophis (5 pokładów) rysują się z
identycznych modułów, a sloty kafli lądują dokładnie na pokładach — również
odbite dla wroga.

## 5-0bo. ZMIANY update40 (AUDYT: ekran opcji, martwe mechaniki, wycieki stanu, UI)

Ten update nie pochodzi ze zgłoszeń gracza — to **samodzielny przegląd kodu**
o który poprosił użytkownik („przefiltruj wszytko i zobacz czy nie znajdziesz
jakis bagow"). Metoda: trzy równoległe audyty (martwy kod / logika i stan /
dźwięk i UI), potem **każde znalezisko zweryfikowane w kodzie zanim cokolwiek
poprawiłem** — kilka zgłoszeń agentów było fałszywych (np. „panel załogi zasłania
kadłub" wynikało z pozycji statku w moim teście, a nie w grze) i zostały odrzucone.

### A. WYCIEKI STANU — trzy rzeczy, które przechodziły tam, gdzie nie powinny

**A1. `_wreckMode` zostawał uzbrojony po ucieczce z wraku.** `_clearWreckMode()`
miało **dokładnie jedno wywołanie** (`_endCombatPeacefully`). Ucieczka z hulka
zostawiała flagę razem ze starą siatką łupu, więc **następne** wybicie załogi
wroga odpalało gałąź „gniazdo martwe, bierz ładownię" zamiast oferty wraku:
darmowa ładownia łupu, **pominięte `_onWin`** (zero CC, zero drop broni) i żywy
statek wroga skasowany w środku walki. Przeżywało też `_onLose`, więc wchodziło
do następnego kontraktu. Teraz czyszczone na KAŻDYM wyjściu z walki.

**A2. Wygrana nie kasowała kary mgławicy.** Wszystkie inne wyjścia (FLED,
ENEMY_FLED, pokojowe) zerowały `reactor.penalty`; to, z którego gracz korzysta
najczęściej — nie. Wygrana zasadzka w mgławicy zostawiała statek na mapie
z **−2 mocy**, więc medbay i tlen gasły aż do następnego skoku.

**A3. `_pickNodeType` NADPISYWAŁO globalną tabelę `NODE_TYPES`.**
`{ ...NODE_TYPES }` to kopia **płytka**, więc `weights.combat.weight = 2`
(„pierwszy skok łatwiejszy") zmieniało stałą modułu **na resztę sesji**:
kolumny 2-4 tej samej mapy generowały się z osłabioną wagą walki, a po dotarciu
do sektora 4 `elite.weight = 4` zostawało **na zawsze** — nowy jednosektorowy
Courier Run generował się z trudnością najgłębszego sektora, jaki kiedykolwiek
odwiedziłeś. Test sprawdza teraz, że ten sam seed zawsze buduje ten sam sektor,
cokolwiek zbudowano wcześniej.

### B. MARTWE MECHANIKI — napisane, opłacone pamięcią, nigdy nieuruchomione

**B1. ZWŁOKI ZNIKAŁY W TEJ SAMEJ KLATCE, W KTÓREJ POWSTAŁY.**
`Ship.update` kończył się bezwarunkowym `this.crew = this.crew.filter(c => !c.dead)`,
a `_updateBodies` biegnie **przed** pętlą załogi — więc nie zobaczył ani jednego
ciała, a w następnej klatce ciała już nie było. To kasowało **cały podsystem**,
o którym gra wprost mówi graczowi: noszenie zabitych do śluzy, ostrzeżenie
„…body is DECAYING — eject it before the crew gets sick!", zarazę trupią
roznoszącą się po pokoju, znaczniki ☠/☣ nad ciałem i tag DECAYING w panelu.
Nic z tego nie mogło się odpalić. (Ranni działali, i dlatego sprzeczność było
tak łatwo przeoczyć.) Ciało leży teraz tam, gdzie padło, aż ktoś je wyniesie —
**wyjątkiem są zwierzęta**: nikt nie urządza pogrzebu szczurowi.
Wszystko, co liczy ludzi, i tak filtruje `!c.dead`, więc żaden licznik się nie zmienił.
**Do tego ciało ma teraz podpis** (`Vega · DEAD` / `· DOWN` / `· DECAYING`) —
skoro gnijący trup zaraża pokój, gracz musi widzieć, kto to jest i w jakim stanie.

**B2. `killOutright` zapisywało `state = 'ok'`.** `serialise()` pisze `state`,
ale nie `dead`/`dying`, a konstruktor wskrzesza wyłącznie po `state === 'dead'`.
Zabity przez wirusa był więc zapisywany jako **żywy członek załogi na 0 hp**:
po przeładowaniu wracał do konsoli, nie liczył się do przegranej, a nagrobek
miał już na wzgórzu.

**B3. TRZY DŹWIĘKI, KTÓRYCH NIE BYŁO.** `Audio.sfx.doorMove` (ship.js),
`scrapPickup` (station.js) i `hullHit` (wreck.js) były **wołane i nie istniały**.
Wszystkie wywołania używają `?.()`, więc optional chaining po cichu je połykał:
żadnego błędu, żadnego dźwięku, żadnego śladu. Każde drzwi w grze, każdy zakup
na stacji i każde spartaczone dokowanie były **nieme**. Dopisane, plus `ratChew`
na zwarcie od szczura. **Test przeszukuje teraz cały `js/` i sprawdza każdą
nazwę dźwięku, także formę dynamiczną `Audio.sfx[cond ? 'a' : 'b']`.**

**B4. `uiHover` — zdefiniowany pierwszego dnia, nigdy nie wywołany.** Nie da się
go grać z testu `hot`, bo to prawda w KAŻDEJ klatce (60 ćwierknięć na sekundę).
`Audio.hoverCue(id)` wyzwala **zboczem**: raz, gdy kursor wejdzie na coś nowego.
Podpięte we wszystkich trzech helperach przycisków i w menu.

**B5. STACJA LOSOWAŁA TOWAR, KTÓREGO NIE DAŁO SIĘ KUPIĆ.** `MODULE_DEFS` +
`stock.modules` + `buyModule` — 1-3 ulepszenia modułów losowane przy każdej
wizycie, do listy, której sklep nie renderuje, kupowane funkcją bez ani jednego
wywołania, po **drugiej, płaskiej cenie** (55-80 CC) obok żywej wykładniczej
`systemUpgradeCost`. To dokładnie ta choroba, która dała buga reaktora w
update34. **Skasowane w całości** — działa jedna ścieżka: klik w moduł na planie
→ panel → UPGRADE.

**B6. `result.risk` — obsługiwany, nigdy nieprodukowany.** `_resolveEvent` od
dawna umie „wybierz kogoś z załogi i zabierz mu 10-40 hp", a **żaden event w
tabeli tego nie ustawiał**: cała kategoria zagrożenia była nieosiągalna. Nowy
event **Micrometeorite Swarm** — przeczekaj (obrażenia załogi + trochę CC) albo
odbij, płacąc 1 He2. Przy okazji `result.fuel` obsługuje wartości ujemne
(idą przez `_burnFuel`, nie przez `addStack(-1)`).

**B7. `hazard: true`** z wraku górniczego było ustawiane i **wyrzucane** —
`_beginDocking` dostawało tylko `seconds` i `rich`. Przekazywane.

**B8. `Ship.removeWeapon` skasowane.** Siedziało tuż pod `uninstallWeapon`, bez
wywołań i z **odwrotnym zachowaniem**: uninstall chowa broń do `weaponCargo`,
removeWeapon ją **niszczyła**.

### C. `randInt` JEST WYŁĄCZNY — i to bolało w pięciu miejscach

`Utils.randInt(min, max)` to `[min, max)`, więc **`randInt(1, 2)` to zawsze 1**.
Trafiło: „dają ci 1-2 He2" (zawsze 1), syfon paliwa z wraku (zawsze 1), wariancję
±1 w liczbie gniazd we wraku (zawsze zero), zakresy `scrap`/`missiles` z tabeli
eventów (górny koniec nieosiągalny) i `crewDamage: [10, 25]` — chip na broni
drukował 10-25, a broń zadawała 10-24.
Nowy **`Utils.randIn(min, max)` — WŁĄCZNY**. Wszędzie, gdzie DANE deklarują
zakres domknięty, ma iść `randIn`.

### D. UI

**D1. POWIADOMIENIA WYCHODZIŁY POZA SWOJE PUDEŁKO.** Stałe 300×28 i **jeden
nieprzycięty `fillText`** — każdy komunikat dłuższy niż ~40 znaków szedł prosto
przez ekran. A większość tych ciekawych jest dłuższa („Something chewed through
the Shields loom…"). Teraz zawijanie do szerokości, pudełko rośnie do liczby
linii, pojedyncze zbyt długie słowo jest **łamane**, całość ucięta do 4 linii.

**D2. PASEK KADŁUBA WROGA WYCHODZIŁ POZA EKRAN.** `Math.max(7, …)` to PODŁOGA
szerokości segmentu, więc komentarz „bar never exceeds ~360px" był nieprawdą:
28 pipsów wychodziło 376 px, a kopia wroga jest kotwiczona na `_W − 320` —
ostatnie pipsy rysowały się **za prawą krawędzią canvasu**. Pasek jest teraz
mierzony i **kotwiczony do prawego marginesu**; test rysuje kadłuby 12/22/28/40/60
i sprawdza, że ani jeden pips nie wychodzi poza ekran.

**D3. LISTY, KTÓRYCH NIE DAŁO SIĘ DOSIĘGNĄĆ.**
- **Koszary**: 5 łóżek + 2 na ulepszenie, a panel mieści 9 kart. Od dziesiątego
  łóżka karty wychodziły poza panel, a przycisk HIRE RECRUIT rysował się **na
  wierzchu** ostatniej. Dodany pasek przewijania + kółko myszy; po zatrudnieniu
  widok skacze na ostatnią stronę, gdzie wylądował nowy człowiek.
- **Regał zbrojowni**: broń poza trzecią pozycją miała tylko napis
  „…and N more on the rack" — **bez FIT i bez SELL**. Broń, do której nie można
  dojść, to broń, której nie można sprzedać. Pasek przewijania; przyciski niosą
  **indeks BEZWZGLĘDNY** (przewinięty widok oddający indeks widoczny sprzedawał
  cudzą broń — test czyta teraz `arg` przycisku, nie wywołuje `_act` ręcznie).

**D4. EKRAN OPCJI — dźwięk dało się w końcu ściszyć.** `Save.getSetting/setSetting`,
`_defaultSettings()` z trzema poziomami głośności i `Audio.setMasterVolume/
SfxVolume/MusicVolume` **istniały od zawsze i nie były podpięte do niczego**.
Gra z proceduralną muzyką i bez regulacji to gra, w którą gra się na wyciszeniu.
Trzecia pozycja w menu → trzy suwaki (MASTER / EFFECTS / MUSIC), MUTE i BACK
(albo ESC). Przeciąganie jest **na żywo** (słyszysz, co ustawiasz), zapis do
save'a następuje **przy puszczeniu** — `Save.setSetting` dotyka localStorage.
Poziomy są wczytywane przy starcie (`Audio.applySettings()`, PO `Save.load()`).

### E. Poprawka w samych testach

`tests/harness.js` miał `measureText: () => ({ width: 10 })` — **stała 10 dla
każdego napisu**. Wszystko, co układa tekst przez mierzenie (`_clip`, plakietki
z imionami, nowe zawijanie powiadomień), było więc dla całego zestawu testów
**niewidzialne**: każdy napis „się mieścił", niezależnie od długości. Teraz
`długość × 6 px`, czyli mniej więcej to, co robi monospace w tej grze — i dopiero
to pozwoliło napisać sensowne testy układu.

**Testy:** `run_tests.js` **1551** (nowe sekcje 110–118), `smoke_draw.js` 32,
`browser_test.js` 45. **24 celowe psucia, wszystkie złapane** — jedno przeszło
za pierwszym razem (test wołał `_act('sellGun', 3)` wprost, więc nie widział buga
siedzącego w ARGUMENCIE przycisku) i wymusiło nowy accessor `BaseScreen._zonesFor`.
Ekran opcji przeklikany na żywo w przeglądarce: przeciągnięcie MUSIC ustawiło
0.20 i w save'ie, i w węźle wzmocnienia; MUTE wyzerował master w obu.

## 5-0bp. ZMIANY update39 (He2 jako ładunek, mgła na mapie, szczury księżycowe, HP w koszarach)

**1. HP ZAŁOGANTA W BAZIE.** Karta w koszarach ma teraz pasek HP i liczby
(`22/100`), a człowiek poniżej 30% dostaje napis **WOUNDED**. Rana wraca z
kontraktu razem z załogantem (`returnFromRun` zapisuje serializowaną załogę
as-is, nic nie leczy w bazie), więc baza była **jedynym miejscem, gdzie tego nie
było widać** — wybierałeś weterana, startowałeś i dowiadywałeś się w pierwszym
abordażu, że ma 20 hp.
Karty w koszarach to **czyste rekordy z save'a, nie instancje `CrewMember`**
(dlatego `_crewStar` liczy gwiazdkę ręcznie) — `_crewHp` czyta `hp`/`maxHp`
defensywnie, bo starsze save'y nie mają tych pól i wychodziło `NaN`.

**2. He2 TO ŁADUNEK, NIE ZBIORNIK.** Zgłoszone: „ikony zbiorniki musza byc
w ladowni aby ich statek mogl uzywac tak jak rakiety, nie ma w ladowni he2 nie
ma paliwa". Dokładnie tak — paliwo było **ostatnim miejscem, gdzie przedmiot
z ładowni zamieniał się w niewidzialną liczbę**.
- `Ship.fuelCount()` = `cargo.countOf('fuel')`, dokładnie jak `missileCount()`.
- Skok bierze `takeStack('fuel', 1)` z ładowni; **pusta ładownia = brak skoku**,
  choćby licznik w save'ie mówił co innego (test to sprawdza kłamiącym licznikiem).
- `run.fuel` **jest już tylko LUSTREM** — `_syncFuel()` co klatkę, tak samo jak
  `_syncAmmo()`. Zostaje dla HUD-u, sklepu i starych save'ów.
- Każda wypłata He2 (event, SOS, syfon z wraku, auto-dok) idzie przez `_addFuel`,
  który **melduje, ile się nie zmieściło**, zamiast pompować licznik.
- `Station.buyFuel(amount, run, ship)` ładuje do ładowni z próbnym przebiegiem
  (`CargoGrid.deserialise` jako dry-run) — płacisz tylko za to, co weszło.
  Bliźniak `buyMissiles` stał 12 linijek niżej od update35.
- Ucieczka z walki też pali komórki, nie licznik.
- **Zbiornik zniknął z bazy**: kroki `− / + / MAX` „He2 IN THE TANK" zastąpił
  odczyt `He2 PACKED: n`, a `Base.launch()` **ignoruje** argument `fuel`
  (i nie opróżnia już półki). Ostrzeżenie przy LAUNCH liczy to, co spakowane.
- Kanister nie ma czego „otworzyć" — `POUR INTO TANK` zniknął z ekranu łupu.
- Przy okazji: `_holdSummary` czytał `it.def.amount` na stosach, czyli
  `undefined` — karta THIS LAUNCH pokazywała **NaN** dla He2 i rakiet.

**3. WRAKI NIE PŁONĄ.** `igniteDerelict` **skasowana**, nie wyłączona. Wrak
dryfuje od lat, ma jedną jednostkę energii i idzie ona na powietrze; pożar przy
zegarze, którego nie masz z czego opłacić, znaczył tylko „zawróć". Gniazda są
tym, po co się tam wchodzi.

**4. WIDZISZ JEDEN SKOK DO PRZODU.** Mapa sektora ma trzy poziomy widoczności
(`SectorMap.visibilityOf`):
```
known    gdzie stoisz, gdzie byłeś, dokąd możesz skoczyć  → pełny rysunek, klikalne
horizon  krok dalej                                       → przygaszone '?' na sensorach
dark     reszta                                           → w ogóle nierysowane
```
Krawędź rysuje się tylko, gdy **oba** końce są co najmniej na horyzoncie —
inaczej sam kształt grafu zdradzał sektor. Tooltip nie opisuje węzła, którego
nie zbadałeś. Nagłówek mówi `◌ UNSURVEYED`, a na dole panelu jest wyjaśnienie,
żeby mgła nie czytała się jako błąd rysowania.
**SURVEY PROBE** (`survey_probe`, 1×2, kind `scan`) — przedmiot w ładowni,
przycisk `RUN THE SURVEY` na ekranie ładunku odsłania **cały sektor** i zużywa
sondę. Druga sonda na tym samym sektorze jest odmawiana, nie marnowana.
Odkrycie jest zapisywane (`mapProgress.revealed`) — spalona sonda zostaje
spalona po F5. Sondy: **wraki** (waga 5) i **sklep w bazie** (55 CC).

**5. SZCZURY KSIĘŻYCOWE.** Nowa rasa `rat` (`vermin: true`), własny sprite
(`_genRat` — długie ciało, ogon, cztery łapy, ucho; zero podobieństwa do
pająka), własne HP (18).
- **Skąd się biorą:** losowanie **na skok**. Poniżej połowy zapełnienia ładowni
  szansa to zero; od połowy rośnie do 22% przy pełnej. **Racje żywnościowe**
  (`ration_pack` ma teraz `tag: 'food'`) dokładają +9% za sztukę, do +27% —
  ale **same nie wystarczą**: ciasnota jest wyzwalaczem, jedzenie tylko
  pogarsza sprawę. Max 4 na pokładzie.
- **Co robią:** `Ship.verminTick` — szczur sam w module **przegryza wiązkę
  i zwiera go**. To dosłownie stun: `sys.ionHit(3)` + stun wszystkich w pokoju,
  ta sama ścieżka co pocisk jonowy, więc moduł naprawdę przestaje działać
  i odczyt już umie to pokazać. **Tylko w trakcie walki** — szczur zżerający
  osłony w pustce to obowiązek, ten sam szczur przy nadlatującym kanonierze to
  historia. Poza walką szczur po prostu przenosi się gdzie indziej.
- **Atak na załogę nie wymagał ani linijki kodu:** szczur jest wrogą załogą
  w `ship.crew`, więc bójka w pokoju łapie go sama. Z tego samego powodu twoi
  ludzie zabijają go bez rozkazu.
- **Nie jest człowiekiem:** nowy getter `CrewMember.isBeast` (pająk albo
  robactwo) zastąpił pięć osobnych testów `isSpider` — nie obsadza konsol, nie
  gasi pożarów, nie jest noszony na noszach do medbay i nie liczy się jako ręka
  do pracy. Szczury zjadają też racje w ładowni.
- Kot księżycowy — następny update, razem z kapitanem i perkami.

**Testy:** `run_tests.js` **1464** (nowe sekcje 106–109, przepisane 9, 30, 33,
40, 51, 92), `smoke_draw.js` **32** (nowe kroki: mgła/sonda i sprite szczura),
`browser_test.js` 45. **24 celowe psucia, wszystkie złapane** — w tym dwa, które
przeszły za pierwszym razem i wymusiły wzmocnienie testów (rzut 35% „ranny
zamiast martwy" trzeba było powtórzyć 40 razy, a pożar na wraku łapie się
dopiero, gdy test idzie przez `_startWreckBoarding`, a nie przez `makeDerelict`).

## 5-0bq. ZMIANY update38 (zapis postępu sektora, sloty w modułach, combat tylko wręcz, jaja w różnych pokojach)

**1. EVENTY SPRAWDZAJĄ, CO MASZ NA POKŁADZIE.** Zgłoszone: „chce mi ulepszyć
medical module a takiego nie mam". Okazało się gorzej niż wyglądało: pola
`system_upgrade`, `cost` i `system_damage` były wpisane w tabelę `EVENTS`
i **nikt ich nigdy nie czytał**. Przyjęcie oferty medyka nie kosztowało nic,
nie ulepszało nic i było proponowane kadłubom bez medbay.
- `map.js` → `eventFits(ev, ship)` i `pickEventFor(ship)`. Event z polem
  `requires` (albo z `system_upgrade` w którymkolwiek wyniku) trafia do puli
  **tylko wtedy, gdy statek naprawdę ma ten moduł** (`ship.getSystem(type)`).
- `game.js` `_resolveEvent` obsługuje teraz `system_upgrade` (+ `cost`,
  z komunikatem gdy brakuje CC albo moduł jest na maksie) i `system_damage`.
- Event przypisany do węzła przy generowaniu sektora jest **przelosowywany na
  wejściu**, jeśli przestał pasować (medbay można stracić po drodze).
- Przy okazji dwa nowe eventy z `requires`: `shield_tuner` i `drive_rebuild`.

**2. F5 + CONTINUE WRACA TAM, GDZIE SKOŃCZYŁEŚ — I BEZ BOSSA.** Dwa osobne błędy
w jednym zgłoszeniu.
- **Boss z niczego:** `MISSIONS[run.mission]?.boss ?? 'station'` czyta się jak
  rozsądny default, a jest pułapką — Courier Run ma `boss: null` **celowo**,
  a `null ?? 'station'` to `'station'`. Po przeładowaniu kontrakt bez bossa
  dostawał kolumnę BOSS zamiast wyjścia i uzbrojonego `BossManager`. Teraz
  fallback łapie **tylko nieznany kontrakt**: `mission ? mission.boss : 'station'`.
  Ta sama poprawka w `_nextSector`.
- **Sektor od nowa:** zapis trzymał `(sector, seed, lane)` i nic więcej — mapa
  odtwarzała się identycznie, ale gracz lądował znowu na wejściu.
  `SectorMap.serialiseProgress()` / `restoreProgress()` + nowe pole
  `run.mapProgress = { currentId, visited[] }`, zapisywane przez `_saveShip()`
  (czyli po każdym skoku) i **czyszczone w `_nextSector`**, bo id węzła należy
  do konkretnej mapy. Śmieciowe/obce id jest ignorowane, nie wywala gry.

**3+8. SLOTY W MODULE: KONIEC NACHODZENIA SIĘ.** Zgłoszone dwa razy — „nowy
członek wchodzi na miejsce środkowe, gdzie ktoś już jest" i „3 zaznaczonych
nachodzi na siebie w kokpicie i w engine roomie".
**Przyczyna:** wszystko liczyło GŁOWY, a nie MIEJSCA. Dwa skutki:
  - człowiek już w pokoju mógł sam stać na slocie 1 (bo gdy JEGO wysyłano, było
    tłoczniej) — „jedna głowa, więc ty bierz slot 1" wsadzało nowego w niego;
  - trzech wysłanych naraz mierzyło pokój, **zanim którykolwiek ruszył**, więc
    wszyscy widzieli wolną konsolę.
    Najgorszy wariant: dwóch szło do slotu 0, obaj dochodzili na ten sam piksel
    i **już nigdy się nie ruszali** — reguła pozwala przejść tylko na
    NIŻSZY slot, a niżej niż 0 nie ma.
**Naprawa** — jedno źródło prawdy w `ship.js`:
```js
CrewMember.destPoint()                 // ostatni waypoint albo x/y — dokąd DOJDZIE
Ship.slotIndexAt(x, y, room)           // na którym slocie ktoś stoi (SLOT_GRIP = 13)
Ship.takenStationSlots(room, excl, residentsOnly)
Ship.freeStationSlot(room, excl)       // konsola → lewa → prawa
Ship.allocStationSlots(room, movers)   // po jednym wolnym na głowę, po kolei
```
Idący do slotu **już go posiada**. Przez to przechodzący przez pokój stoi na
drodze (nie wchodzi się w niego), ale **nie jest właścicielem** i nikogo nie
wypycha (`residentsOnly`). Użyte w: rozkazie do modułu (`_crewClickResolve`),
rozkazie abordażowym, `_returnToStations`, `assignStations`, powrocie na posterunek
i marszu do naprawy (szedł na `room.cx/cy`, czyli dwóch naprawiaczy na jeden piksel).

**PASEK HP NAD KAŻDYM.** Rysował się tylko `if (this.hp < this.maxHp)` — więc
„niektórym brakuje paska" znaczyło „ci są zdrowi". Teraz jest zawsze; rząd
zielonych pasków to też sposób, żeby w trzyosobowym module od razu zobaczyć,
który krwawi.

**4. POCISK PRZECIW OSŁONOM ZDEJMUJE JEDNĄ WARSTWĘ.** `ion_basic`, `flak_basic`
i `laser_heavy` miały `shieldDamage: 2` — jedno działo jonowe rozbierało
dwuwarstwową bańkę jednym strzałem. Wszystkie na `1`; broń antyosłonowa bierze
się teraz z szybkostrzelności i serii (flak strzela trójką), nie z podwójnego
zdjęcia. Test pilnuje **całej tabeli**, nie trzech nazw.

**5. WRÓG ZAWSZE MA MIN. 3 ZAŁOGANTÓW (4 PRZY DWÓCH BRONIACH).** Było
`Math.max(sector === 1 ? 2 : 3, ...)`, więc w sektorze 1 trzyosobowa drużyna
wchodziła na pusty statek. Próg liczy **komory broni** (`weaponRooms.length`),
a nie zamontowane działa — komora to to, czym kadłub MOŻE walczyć, więc próg
trzyma się też wtedy, gdy działo jest jedno.

**6. WRÓG NIE SINIEJE PRZY NAPRAWIE.** `_setAnim` dla przeciwnika spadał na
`Animation.crewRepair()` / `crewFight()` / `crewDie()`, a te fabryki generują
klatki w **niebieskim gracza** — tylko `idle`/`walk` miały wariant wroga. Teraz
**każdy stan** idzie przez `Animation.crewByColor(state, this.suitColor())`,
a `CrewMember.ENEMY_COLOR = '#ff2d44'` jest jedną stałą, z której nic nie zbiegnie.
Dotyczyło też walki i umierania, nie tylko naprawy.

**7. `combat` TO UMIEJĘTNOŚĆ WRĘCZ I NIC WIĘCEJ.** XP leciało do **całej załogi**
za wygraną bitwę statków (`combat.js` `_onVictory`, `_endCombatPeacefully`,
wypłata po zwycięstwie) — czyli cały statek uczył się bić, nie bijąc się.
To dodatkowo **spalało jeden z trzech slotów mistrzostwa**, którego kanonier
potrzebował na `weapons`. Zostało jedno miejsce: `CrewMember.creditMeleeSwing()`,
wołane przy każdym ciosie. Obie ścieżki walki wręcz (bójka w pokoju i rozkaz
FIGHT) używają teraz `meleeDamage()` — wcześniej biły `7+lvl*3` kontra
`10*(1+lvl*0.3)` i tylko jedna uczyła. Test sprawdza, że `ship.js`, `weapons.js`,
`systems.js` i `combat.js` **w ogóle nie czytają** tej umiejętności.

**9. JAJA W RÓŻNYCH MODUŁACH, 1–4 NA WRAK.** `rooms[i % rooms.length]` po
pokojach w kolejności kadłuba dawało ten sam pokój za każdym razem przy jednym
jaju i **ten sam pokój dwa razy**, gdy liczba przekroczyła liczbę pokoi.
Teraz: tasowanie pokoi, **po jednym jaju na pokój**, `MAX_DERELICT_NESTS = 4`,
a liczba pokoi jest twardym sufitem. Nagroda i tak wymagała pokonania
**wszystkich** (warunek czyszczenia liczy każdego wrogiego na pokładzie, a śpiące
jajo nim jest) — test tego pilnuje, bo to była druga połowa prośby.

**Testy:** `run_tests.js` **1378** (nowe sekcje 97–105, poprawiona 83),
`smoke_draw.js` 30, `browser_test.js` 45. **20 celowych psuć, wszystkie złapane.**

## 5-0br. ZMIANY update37 (chodzenie po podłodze, wraki z powietrzem, ukryte jaja, mniej chromu)

**1. ZAŁOGA CHODZI PO PODŁODZE.** Zgłoszone: „od razu ida w gore przez wszystkie
moduly". Miejsce przy konsoli leży `OPERATOR_LIFT` pikseli NAD linią chodzenia,
a `moveToOnShip` wkładało ten podniesiony Y wprost w waypoint podróży — więc
człowiek odchodzący od konsoli startował na wysokości konsoli i tak już szedł,
szybując nad pokładem przez każdy mijany moduł.
Trasa składa się teraz z trzech części: **zejdź z konsoli tam, gdzie stoisz →
przejdź pokład na linii chodzenia → wejdź na konsolę dopiero na miejscu**.
Każda jest osobnym waypointem, więc widać zejście, marsz i wejście.

**2. ZAZNACZENIE TO ZNOWU MAŁE JAJKO U STÓP.** To już trzecia wersja: płaski
cień → obwódka całej sylwetki (26×38, trzy razy szersza od człowieka, w ciasnym
module nie dało się nic odczytać) → i teraz to, o co prosił użytkownik: mała
elipsa 14×6 na pokładzie pod postacią. **Obszar KLIKANIA celowo tego nie
naśladuje** — klika się człowieka, nie jego cień, więc `_hitsCrew` zostaje
w rozmiarze ciała (8×14).

**3. WRAK MA ZAWSZE 1 ENERGIĘ I ONA IDZIE NA POWIETRZE.** Wrak był całkowicie
zimny, a rzut 70% na „scrubbery jeszcze działają" **nie robił absolutnie nic**:
`Ship.update` co klatkę przelicza moc każdego modułu z budżetu reaktora, a budżet
wynosił zero — więc `o2.power = 1` było kasowane w pierwszym ticku. Każdy wrak
dusił abordażystów identycznie, cokolwiek pokazał rzut.
Teraz `makeDerelict` zostawia **dokładnie 1 jednostkę** (`reactor.penalty` liczone
tak, by `totalPower === 1`) i tylko życie podtrzymujące z niej czerpie.
Abordaż na jaja wymaga czasu, którego nie da się wydać, gdy kończy się powietrze.
> Przy okazji: **abordażyści nie sabotują wraku.** Kod „jesteś na wrogim statku,
> niszcz moduły" nie odróżniał wraku, więc własna drużyna metodycznie rozwalała
> życie podtrzymujące, w którym stała.

**4. JAJA SĄ NIEWIDOCZNE, DOPÓKI SIĘ NA NIE NIE WEJDZIE.** `sp.revealed = false`
przy tworzeniu; `Ship.hatchNests` ustawia `revealed` dopiero, gdy ktoś jest
w tym pokoju, a `CrewMember.draw` nie rysuje nieodkrytego kokonu.
Do tego wejście już **nie wykluwa natychmiast** (stary kod robił `hatchT -= dt*6`,
a linijkę niżej wykluwał bezwarunkowo — mnożnik był martwy), tylko przyspiesza
6×, więc widać, na co się weszło, zanim to pęknie.
Komunikat po zadokowaniu **nie podaje już liczby sygnatur** — to psuło całą ideę
szukania.

**5. SEKTOR 1 BEZ OSŁON U PRZECIWNIKÓW.** Jedna warstwa osłon to sześć sekund na
pocisk startowego lasera; pierwszy sektor ma uczyć sterowania, a nie być
najtwardszą ścianą w grze. Losowanie dla sektora 1 to teraz cloak albo nic.
Osłony wracają w sektorze 2 i dalej.

**6. KONIEC PIPÓW ENERGII NA POKOJACH.** Kwadraciki 4×9 wzdłuż górnej krawędzi
każdego modułu powtarzały to, co i tak mówi pasek mocy na dole ekranu, a przy
okazji zderzały się z plakietką modułu. Pasek jest odczytem; pokój jest obrazkiem.
Uszkodzenia dalej widać jako czerwony wash. **Miniatury w hangarze zachowują
swoje pipy** — to co innego (statyczny poziom modułu, nie żywa moc).

**7. JEDEN PRZYCISK DO PAKOWANIA.** Z karty THIS LAUNCH zniknął drugi
„PACK HOLD" — półka po lewej stronie tej samej zakładki już go ma, a dwa
przyciski do jednego ekranu to tylko pytanie, który jest prawdziwy. THIS LAUNCH
jest teraz odczytem.

**Testy:** `run_tests.js` **1285** (nowe sekcje 93–96, przepisane 17, 55, 62),
`smoke_draw.js` 30, `browser_test.js` 45. 11 celowych psuć, wszystkie złapane.

## 5-0bs. ZMIANY update36 (hakowanie drzwi, sporne moduły, cmentarz z historią służby, kontrakt startowy)

**1. GRAVEYARD znika z menu głównego.** `MENU_ITEMS` to teraz `['ENTER BASE','CONTINUE']`.
Polegli mieszkają na zakładce MEMORIAL („THE HILL") w bazie. DOM-owy modal
`UI.showGraveyard` skasowany razem z eksportem — nic go już nie wołało.

**2. HISTORIA SŁUŻBY na nagrobku.** Nowe pola `CrewMember`: `battles`, `wins`,
`escapes`, `kills` — serializowane i przepisywane do `Save.addToGraveyard`.
- `battles` i reset zamków: **`Ship.onBattleStart()`**, wołane RAZ na walkę dla
  OBU kadłubów z `CombatManager.begin()`. Nie z `markCombatStart()` — to jest
  wołane z trzech miejsc w game.js i liczyłoby część walk podwójnie.
- `wins`/`escapes`: `_creditCrew(pole)` w game.js, liczy też abordażystów
  stojących na wrogim kadłubie (byli tam jak najbardziej).
- `kills` w zwarciu: `strike()` sprawdza, czy cel PADŁ od tego ciosu, i woła
  `creditKill()`. Wcześniej ofiara zapisywała jako zabójcę **string `'crew'`** i
  nikt nigdy nie dostawał zaliczenia.
- `kills` z działa: `Weapon.fire(..., gunners)` wkłada obsadę wieży do pocisku
  (`Projectile.gunners`), a `receiveHit` zalicza im każdego zabitego.
- Limit cmentarza 50 → **200** wpisów.

**3. RODZAJE NAGROBKÓW.** `_heroScore` = zabici×3 + wygrane×2 + walki + ucieczki
+ opanowane skille×2, a `_graveTier` mapuje to na cztery znaczniki:
krzyż (żółtodziób) → płyta nagrobna → obelisk (weteran) → **pomnik z wieńcem
laurowym i gwiazdą** (bohater). Wzgórze, na którym każdy krzyż jest taki sam,
nie mówi nic o tym, kto pod nim leży. Karta epitafium pokazuje teraz
actions / won / fled / kills i rangę znacznika.

**4. ABORDAŻ HAKUJE DRZWI, NIE ROZWALA.** Użytkownik: „nie sa rozwalane drzwi a
hakowane, po zhakowaniu gracz moze przechodzic".
- `Door.hacked = {player, enemy}` + `hackT`, `hackBy(strona, dt)` (2.5 s pracy),
  `hackOpen(strona)`, `resetHacks()`. Pasek postępu rysowany nad drzwiami.
- `CrewMember._isIntruderOn(ship)` + `_doorBlocking(..., includeOpen)`: **intruz
  musi zhakować KAŻDE drzwi, które przekracza — także takie, które obrońca
  zostawił otwarte.** Raz na walkę, na stronę.
- Wcześniej drzwi w ogóle nie wiedziały, na czyim są statku: wrogi abordażysta
  przechodził przez ZARYGLOWANE drzwi gracza tak samo łatwo jak własna załoga,
  więc zamykanie drzwi kupowało jakąś sekundę zwłoki i nic więcej.
- **Śluza abordażowa też jest hakowana, nie wybijana.** `breached = true`
  przypinało właz otwarty na resztę RUNU — ten pokój tracił powietrze na zawsze
  i żadne zadanie naprawcze w grze nie potrafiło go zamknąć. Teraz właz cyklicznie
  się domyka po wejściu.

**5. SPORNY MODUŁ NIE DZIAŁA.** Dwie osobne dziury naprawione naraz:
- **`crewInRoom()` nie miało filtra strony.** `ship.crew` zawiera WSZYSTKICH
  fizycznie na pokładzie, w tym wrogich abordażystów (dopisywanych do rosteru
  BRONIĄCEGO statku). Bez filtra najeźdźca stojący w twojej wieży **obsługiwał
  twoje działo** (i dodawał swój skill do prędkości ładowania), w tarczowni
  **przyspieszał twoje ładowanie i zbierał twoje XP**, w medbayu **był leczony
  przez twoich medyków**, a w kokpicie **dodawał swój pilotaż do twojego uniku**.
- **`crewOperating(roomId)`** zwraca pustą listę, gdy pokój jest sporny
  (`roomContested`: są w nim ludzie obu stron). Sporny kokpit = zero uniku,
  sporna wieża = działo nie ładuje („NO CREW"), sporne tarcze = brak regeneracji.
  To jest to, co czyni z abordażu sposób na wyłączenie statku, a nie tylko na
  skubanie kadłuba.
- **`occupantsOf(roomId)`** = wszyscy w pokoju niezależnie od strony — ostrzał,
  stun i pożary nie patrzą na mundur, tylko obsada modułu patrzy.
- Walka wręcz ustawia wreszcie animację `fight` i zwrot postaci (wcześniej
  abordaż wyglądał jak dwoje ludzi stojących bez ruchu).

**6. IKONA RAKIET.** Zniknęła w update35, gdy SUPPLY było przebudowywane wokół
jednej półki — przepisana karta zachowała zbiornik He2 i zgubiła regał rakiet.
Przywrócona; **do tego pasek zasobów w HUD dostał prawdziwy piktogram głowicy**
(`STAT_ICONS.ammo` istniał od update34 i miał jedno jedyne wywołanie — zbrojownię
w bazie, czyli nigdy tam, gdzie gracz patrzy w walce).

**7. TRZY PRZYCISKI PACK HOLD → jeden + skrót.** Z paska kontraktów zniknął
trzeci przycisk, a manifest (kontrakt / statek / załoga) przeniesiony do karty
**THIS LAUNCH**, obok ładowni, którą opisuje.

**8. NOWY KONTRAKT „Courier Run"** — 1 sektor, **bez bossa**, bonus 30 CC.
`SectorMap(..., hasBoss)`: przy kontrakcie bez bossa ostatnia kolumna to EXIT,
a wyjście z ostatniego sektora kończy kontrakt. Karty kontraktów pokazują
`BOSS` / `NO BOSS`.

**9. WIRUS: 3 → 6 walk.** Trzy walki ledwie wystarczały na dotarcie do stacji
`science`, więc infekcja czytała się jak wyrok, a nie jak zegar do pobicia.

**10. Bugi znalezione przy okazji:** `Save.addToGraveyard?.(victim.name, ...)`
w evencie „oddaj załoganta jako trybut" przekazywało STRING zamiast obiektu —
`deepClone(undefined)` rzucał i event wysypywał się w połowie.

**Testy:** `run_tests.js` **1226** (nowe sekcje 86–92, przepisane 3 i 55),
`smoke_draw.js` 30, `browser_test.js` 45. 19 celowych psuć, wszystkie złapane.

## 5-0bt. ZMIANY update35 (JEDEN MAGAZYN, klasy broni, cmentarz, 6 bugów załogi)

**1. JEDEN MAGAZYN NA WSZYSTKO.** Użytkownik: „sa 2 oddzielne magazyny na bron
i rakiety i 2 na inne, zlikwiduj salvage i zrob jeden glowny magazyn".
Były w rzeczywistości TRZY: dwa liczniki (`warehouse.fuel/missiles`), tablica
broni (`armoury`) i siatka (`stash`). Ten sam regał w fikcji, trzy różne zestawy
reguł w kodzie — i każdy potrzebował własnego uzgadniania ze spakowaną ładownią,
stąd brały się duplikacje.
- `b.store` — **jedna `CargoGrid` 8×6** (+1 kolumna za ulepszenie WAREHOUSE).
  He2 w kanistrach, rakiety w regałach, broń w skrzyniach, apteczki po prostu
  jako apteczki. `Base.warehouseGrid()` / `commitWarehouse()`; stare nazwy
  (`stashGrid`, `commitStash`, `storeGrid`) to aliasy, żeby nic nie padło.
- `supply()` LICZY z siatki, `store()/take()/buySupply()` dokładają/zdejmują
  kontenery, `armoury()` to po prostu skrzynie z bronią leżące na tej siatce.
- **`_migrateStores()`** składa stary zapis w jedną siatkę raz, przy pierwszym
  odczycie, i zeruje stare pola — nie da się zmigrować dwa razy.
- **INWARIANT: przedmiot jest na półce ALBO w ładowni, nigdy w obu.** Dlatego
  `pruneHold()` jest teraz no-opem (został dla starych wywołań), a `holdCost()`
  służy już tylko do raportowania. Klasa błędów „spakuj broń, potem ją zamontuj
  i poleć z nią dwa razy" przestała być wyrażalna w modelu.
- **PACK HOLD i OPEN WAREHOUSE to JEDEN ekran** (`_openPackScreen`): półka po
  lewej, ładownia po prawej, SELL działa na półce. `_openWarehouseScreen`
  skasowany.
- **Spakowana ładownia jest ZAPISYWANA** (`b.packedHold`). Rzeczy wyciągnięte
  z półki fizycznie z niej znikły — gdyby ładownia żyła tylko w pamięci
  BaseScreen, zamknięcie gry by je wyparowało.
- **`Base.launch()` bierze `store` od wywołującego.** BaseScreen trzyma ŻYWĄ
  siatkę, z której gracz właśnie przeciągał; ponowny odczyt z zapisu wskrzesiłby
  wszystko, co spakował. Jeden magazyn zostaje jednym magazynem tylko wtedy, gdy
  wszyscy pracują na tej samej kopii.
- Zakładka SUPPLY: **THE SHELF** (lista wszystkiego + zajętość + wartość),
  **SHOP & TANK**, **THIS LAUNCH**. Karta SALVAGE zniknęła.

**2. KLASY BRONI — każda mówi dokładnie, co robi.** `damage` robiło wcześniej
cztery rzeczy naraz (kadłub, poziomy modułu, mnożnik obrażeń załogi i domyślnie
szansę na dziurę), więc nie dało się opisać działa, które zdejmuje osłony i nie
robi nic więcej. Nowe pola w `WEAPON_DEFS`: `shieldDamage`, `pierceShields`,
`hull_damage`, `moduleDamage`, `crewDamage:[min,max]`, `fireChance`,
`breachChance`, `stunTime` — i `receiveHit` czyta KAŻDE z nich.
- **LASER** — moduł + załoga, mała szansa na pożar (6%), jeszcze mniejsza na
  dziurę (2%).
- **RAKIETY** — to samo, ale **ignorują osłony**, pożar 30%, dziura 45%.
- **ION** — **tylko osłony**: 0 kadłuba, 0 modułu, 0 obrażeń załogi.
  Jeden pocisk = **1 s stuna** modułu I załogi w nim. `ionHit(sekundy)` to
  teraz prawdziwe odliczanie w sekundach (`_stunT`), a nie stos trafień po
  5 s każde — jedno działo jonowe blokowało moduł na stałe.
- **FLAK** — 0 kadłuba, 0 modułu, mały dmg załogi, zdejmuje **2 paski osłon**
  na pocisk × 3 pociski.
- **Osłony zdejmują `shieldDamage` PASKÓW**, nie zawsze jeden — bez tego
  „przeciwosłonowy" nie znaczyło nic.
- **Nowy stun załogi** (`CrewMember.stun(s)`): nie chodzi, nie naprawia, nie
  walczy, iskry nad hełmem. Widać, DLACZEGO gość w wieży przestał cokolwiek robić.
- Chipy statystyk pokazują tylko to, co dane działo REALNIE robi — ion nie ma
  chipa DMG, laser jednostrzałowy nie ma SHOTS, rakieta mówi `SHIELDS bypass`.

**3. CMENTARZ (zakładka MEMORIAL) — „THE HILL".** Wzgórze na Księżycu z kraterami,
krzyż za każdego poległego, kolorowa kropka = korporacja; najechanie na krzyż
otwiera epitafium (imię, korporacja, co go zabiło, sektor, opanowane skille).
Dane bierze z ISTNIEJĄCEGO `Save.getGraveyard()` — **nie** dorobiłem drugiego
magazynu poległych, po tym, czego uczy punkt 1. Do wpisu doszła `mission`.

**4. HP KADŁUBA W KWADRACIKACH w hangarze**, nad odczytem modułów (`_hullStrip`).
Jeden kwadrat na punkt, a przy wielkich kadłubach N punktów na kwadrat (podpisane).
Kolor zielony/pomarańczowy/czerwony wg procenta.

**5. BUG: winda gubiła pasażera.** Zgłoszone: „jak zalogant jedzie na dol winda
i kliknę na gorny modul, nie jedzie winda tylko sie przemieszcza po skosie".
Człowiek w JADĄCEJ kabinie ma Y, które nie należy do żadnego pokładu, więc
`floorAtY()` zwracało -1 i odpalała się gałąź „to samo piętro, po prostu idź" —
prosta linia. Teraz `moveToOnShip()` wykrywa `_ridingShaft` i **zawraca kabinę**
(`moveCabinTo`), a jeśli ten szyb nie obsługuje celu — parkuje rozkaz
(`_rerouteAfterRide`) i przelicza go dopiero, gdy pasażer stoi na prawdziwym
pokładzie.

**6. BUG: nie dało się przełączyć zaznaczenia na innego zaloganta.** To był
koszt reguły z update34 („żywe zaznaczenie zamienia klik w rozkaz"). Przełączanie
wygrywa — klik w załoganta ZAWSZE go zaznacza. Klik w moduł chroni teraz
GEOMETRIA: obszar trafienia to **elipsa wielkości rysowanej obwódki** (8×14)
zamiast koła 13 px, a operator stoi wyżej (`OPERATOR_LIFT` 8 → 14), więc pod nim
zostaje wolna podłoga do klikania. (Wzorzec FTL: w obsadzony moduł klika się tam,
gdzie nikt nie stoi.)

**7. BUG: abordaż gasił zaznaczenie i ikony.** Dwie przyczyny naraz:
`_launchBoarders`/`_recallBoarders` wołały `UI.deselectCrew()`, a przyciski
BOARD/RECALL/RETREAT nie ustawiały `_pressConsumed`, więc TEN SAM klik leciał
dalej do `_crewClickResolve`, nie trafiał w żaden pokój i czyścił zaznaczenie.
Usunięte + `_pressConsumed = true` na przyciskach + `_crewMouseUpdate` robi teraz
`|| _pressConsumed` zamiast nadpisywać flagę.

**8. BUG: operator konsoli był spychany.** Ranking po `id` powodował, że nowy
załogant z „mniejszym" id wyrzucał tego, który już stał przy konsoli, a
przechodzący przez pokój potrafił go przesunąć. **Zasada: kto stoi na slocie,
ten go ma** — wolno tylko awansować na slot, na którym NIKT nie stoi. Operator
oddaje konsolę dopiero, gdy sam wyjdzie; wtedy flankier na nią wchodzi.

**9. BUG: leczenie wirusa nie trzymało.** Wszystko kupione w porcie (spawany
kadłub, wyleczony załogant, moduł, broń) było nakładane na ŻYWE obiekty i nie
trafiało do zapisu, podczas gdy CC schodziło natychmiast przez `Save.updateRun`.
Pieniądze zostawały wydane, towar nie. Wyjście ze stacji przeniesione z
`_drawStation` do nowego **`_updateStation(dt)`** (zmiana stanu należy do update,
nie do rysowania) i robi `_saveShip()`.

**10. BUG: `CrewMember` dostawał NOWE id przy każdym wczytaniu** (`Utils.uid()`
ignorowało `cfg.id`, choć `serialise()` id zapisuje). Wszystko, co dopasowuje po
id przez granicę zapisu — wybór załogi w barakach, `Base.removeCrew`,
`_rescueId` — po cichu się rozjeżdżało. Teraz `cfg.id || Utils.uid()`.

**11. BUG: wygrana z bossem kasowała abordażystów.** `_finishContract()` szło bez
`_recoverBoarders()`, a dokowanie bankuje tylko `_playerShip.crew` — kto stał na
kadłubie bossa, znikał z baraków za wygranie walki. Dodane.

**Testy:** `run_tests.js` **1148** (nowe sekcje 78–85, przepisane 15/17/35/64/65/67),
`smoke_draw.js` 30, `browser_test.js` 45. Każda nowa sekcja zweryfikowana celowym
psuciem kodu (17 psuć, wszystkie złapane).

## 5-0bu. ZMIANY update34 (WAREHOUSE wchłonięty przez SUPPLY, UI bazy, załoga przy konsolach, 3 realne bugi)

Duża partia z listy użytkownika. Kolejność niżej = kolejność w jego wiadomości.

**1. Zakładka WAREHOUSE ZNIKA — półka jest trzecią kartą w SUPPLY.**
Użytkownik: „warhouse jest zbedny zrob wszytkie przedmioty w supplay".
`TABS` w `basescreen.js` ma teraz 5 pozycji (HANGAR/ARMOURY/CREW/SUPPLY/UPGRADES),
a `_drawSupply` rysuje CZTERY karty zamiast trzech: **He2 · MISSILES · SALVAGE · THIS LAUNCH**.
Karta SALVAGE (`_shelfCard`) pokazuje zajętość półki, jej wartość w CC, listę
pogrupowaną po rodzaju i przycisk **OPEN SHELF** → ten sam `LootScreen`
(akcja `'warehouse'`, `_openWarehouseScreen` w game.js) co przedtem.
`_drawWarehouse` usunięte. **UWAGA na współrzędne w testach:** pasek zakładek to
`102 + i*132`, więc wszystko po CREW przesunęło się o jedno pole w lewo.
> NIEZROBIONE, uzgodnione wcześniej: ekran sortowania łupów po powrocie z kontraktu
> (magazyn bazy + ładownia statku obok siebie zamiast cichego auto-chowania
> w `_dockAtBase`). Zostaje jako pierwszy punkt §6.

**2. Listy w HANGARZE się przewijają.** Stocznia pokazuje 3 kadłuby, Twoje burty
JEDEN — dzięki czemu pod kartą zawsze zostaje miejsce na odczyt modułów.
`_yardScroll`/`_berthScroll` + `_clampScroll()` (wołane też przed KAŻDYM
rysowaniem, bo sprzedanie kadłuba może zostawić listę przewiniętą za koniec —
karta by wtedy po prostu zniknęła). Pasek `_scrollBar()` rysuje się **tylko
gdy jest co przewijać**; strzałki ▲/▼ to akcje `scrollYard`/`scrollBerth`,
działa też kółko myszy nad kolumną (`Input.mouse.scrollDelta`, czytane PRZED
strefami kliknięć, żeby scroll nie liczył się jako klik w kartę pod kursorem).

**3. Odczyt modułów przerysowany.** Było: ikona, nazwa i pipsy w jednej linii,
pipsy od `mx+80` — na wąskiej kolumnie wchodziły na sąsiedni moduł.
Jest (`_moduleCell`): **ikona z lewej, KWADRACIKI NAD NAZWĄ**, ikona wysokości
całego bloku (pipsy + nazwa), nazwa przycinana do własnej kolumny (`_clip`).
Trzy moduły w linii, a **REAKTOR ZAWSZE SAM, w osobnym akapicie pod kreską** —
ma najwyższy poziom i najdłuższy ciąg pipsów (limit 20 zamiast 8), więc dzielenie
linii z czymkolwiek gwarantowało kolizję.

**4. BARAKI pokazują gwiazdkę i zarazę.** Załoga w barakach to zwykłe obiekty
z save'a, nie instancje `CrewMember`, więc `getStarRating()` tam nie istniał —
dlatego to było JEDYNE miejsce, gdzie weteran wyglądał jak zielony rekrut.
Nowe `_crewStar(c)` (złota ★ = 3 opanowane skille, srebrna = ≥1) i `_crewPlague(c)`
(pulsujące ☣ VIRUS / ☣ INFECTED, `_blink` liczony w `update(dt)`).
Siatka skilli przesunięta na `x+190` i zwężona do 56 px/kolumnę, żeby nazwa,
gwiazdka i znacznik zarazy miały gdzie się zmieścić.

**5. Statystyki broni: JEDNA lista, dwie powierzchnie.** Użytkownik: „DMG napis
ikonka dmg i liczba, tak jak jest power". Nowe `weaponStatChips(def, {chargeTime})`
w `weapons.js` zwraca DANE (klucz, etykieta, ikona, wartość, kolor) — a ikony
są JEDNĄ definicją (`Renderer.STAT_ICONS`, prymitywy w pudełku 0..10) z dwoma
interpreterami: `Renderer.drawStatIcon()` na canvas i `Renderer.statIconSVG()`
jako inline SVG do DOM-owego sklepu na stacji. Zmieniasz kształt raz, zmienia się
w obu miejscach. Sklep (`ui.js statChips`) i ARMOURY w bazie (`_statChips`,
canvas) rysują teraz to samo. `_chargeStrip` w bazie usunięty — chip CHARGE go
zastąpił; wiersze ARMOURY urosły do 68/76 px, w regale mieszczą się 4 zamiast 5.

**6. Winda równa się z drzwiami.** Dwie różne linie na pokładzie i to jest
sedno: `floorYs` to linia CHODZENIA załogi (`room.y + h*0.65`), a drzwi wiszą
na linii ŚRODKA (`room.y + h*0.5`) — 12 px wyżej na fregacie. Szyb rysował
podesty i kabinę na linii chodzenia, stąd „pusty szyb niżej niż drzwi".
Teraz: **logika zostaje na linii chodzenia, RYSOWANIE idzie po linii drzwi**
(`shaft.setDoorYs()` + `shaft.drawY()` z interpolacją między piętrami).
Kabina ma wysokość `ElevatorShaft.DOOR_H` (34 — dokładnie tyle co drzwi, było 22)
i zatrzymuje się dokładnie na podeście. Pasażer jedzie na wysokości rysowanej
kabiny, ale **wysiada na linię chodzenia** — nic w dół rzeki się nie zmienia.
Trzon szybu bierze wysokość z `setExtent(hullTop, hullBottom)` zamiast stałych
`-50/+77` dobranych do 80-pikselowych pokładów fregaty (na `boss_station`
z pokładami 60 px wystawał 11 px ponad kadłub).

**7. Załoga staje PRZY KONSOLI, nie obok niej.**
- `Ship.stationSlot(room, i)`: **0 = konsola (środek, `Ship.OPERATOR_LIFT`=8 px wyżej),
  1 = lewa flanka, 2 = prawa**. Było `[-1, 1, 0]`, czyli pierwszy wchodzący szedł
  W LEWO — i to jest cały zgłoszony problem „czesto stoi zboku".
- `assignStations()` liczyło zajętość PO ustawieniu `homeRoomId`, więc pierwszy
  załogant liczył sam siebie jako obecnego i dostawał slot 1. Poprawione.
- `moveToOnShip()` przyklejało KAŻDY cel do linii chodzenia, kasując `OPERATOR_LIFT`.
  Teraz honoruje mały, celowy podskok (`snap()`), resztę dalej przykleja.
- Nowe: **załoga sama się układa**. W `TASK.IDLE`, stojąc we własnym module,
  każdy bierze slot wg rangi po `id` — więc gdy kolega przechodzący przez pokój
  odejdzie, konsola zostaje zajęta zamiast stać pusta do końca runu.
- `_returnToStations()` (przycisk RETURN) i bezczynny powrót do stanowiska
  wysyłały wszystkich na `room.cx/cy` — trzy osoby lądowały na jednym pikselu.
  Oba używają teraz slotów.
- **Nowa animacja `operate`** (`animation.js _genCrewOperate`): tyłem do gracza
  (brak wizjera), obie rękawice pracują na podświetlonej konsoli w przeciwfazie.
  Włącza się dla tego, kto stoi na slocie 0 w module Z SYSTEMEM; flankierzy
  zostają na zwykłym `idle` — dzięki temu widać, KTO obsługuje moduł.

**8. Obwódka zaznaczenia, imię i ikona wirusa.**
- Obwódka: było 26×38 px zaczepione na `c.y-8` — trzykrotność szerokości postaci,
  15 px nad hełmem; w ciasnym module obwódki nachodziły na siebie zamiast kogokolwiek
  wskazywać. Jest 14×26 na `c.y-1` (realny środek sprite'a: figura ma ~9×23 px
  w pudełku 32×32). Trafianie kliknięciem też przeniesione z `c.y-14` na `c.y-1` —
  hot spot siedział dotąd na tabliczce z imieniem, nie na człowieku.
- Stos nad głową poukładany od nowa, nic się nie nakłada:
  `y-19` pasek życia → `y-31..y-20` tabliczka z imieniem → `y-38` znacznik zarazy.
  Imię rysowane PRZED znacznikami (było po — nieprzezroczysta tabliczka
  zamalowywała migające ☣ co klatkę, więc wirusa po prostu nie było widać).
- **Żywa selekcja zamienia klik w ROZKAZ.** To jest warunek konieczny punktu 7:
  operator stoi teraz na środku modułu, czyli dokładnie tam, gdzie klika się
  wydając rozkaz. Reguła: bez zaznaczenia klik w załoganta = zaznacz go (bez zmian);
  z zaznaczeniem klik gdziekolwiek w pokoju = ROZKAZ, nawet jeśli ktoś tam stoi;
  klik w JUŻ zaznaczonego = zawęź do niego; dwuklik = zaznacz wszystkich;
  klik poza kadłubem = wyczyść zaznaczenie. Żaden gest nie zniknął.

**9. BUG: silnikowa umiejętność nie robiła NIC.** `CrewMember.engineBonus()`
istniała od zawsze i **nie miała ani jednego wywołania** w całym `js/`. Załoga
w maszynowni dostawała XP za każdy unik (`ship.js receiveHit`), awansowała, grała
dźwięk awansu — i nie zmieniało to uniku o ani promil. Terra dostaje jeszcze
podwójne XP z silników, więc gra aktywnie pchała gracza w ślepy zaułek.
`get evasion` sumuje teraz bonus załogi z MASZYNOWNI obok bonusu pilotów.
Przy okazji: getter mieszał trzy różne testy „żywy" (`!dead && !dying` na bramce,
samo `!dead` przy bonusie) — ranny pilot leżący na podłodze dalej pilotował.
Wszędzie `crewInRoom`/`alive`.

**10. BUG: przyspieszenia od skilla były niewidoczne albo mylące.**
- **Tarcze:** `shieldBonus()` to 0.15 NA POZIOM — ułamek, jak u działonowego —
  a był ODEJMOWANY od 7 sekund. Mistrz kupował 0.45 s: 6% za trzy poziomy pracy.
  Teraz skaluje czas (`* (1 - bonus)`, limit 60%).
- **Broń:** mechanika działała, ale ODCZYT kłamał — `renderer.js` i `weapons.js`
  liczyły kwadraciki i napis „10s" z `def.chargeTime`, czyli z tabliczki
  fabrycznej. Stąd zgłoszenie „jest 10 kwadracikow ale laduje w 8". Teraz
  `chargeSeconds()` liczy z `chargeTime(this.crewBonus)` (bonus zapamiętywany
  w `update()`), więc **10 s / 10 kwadratów zmienia się na 8 s / 8 kwadratów**,
  a liczba świeci na zielono z przekreśloną wartością fabryczną obok.
- Przy okazji `chargeTime()` dostało limit: bonus to zwykła SUMA po załodze
  w wieży, więc trzech mistrzów dawało dokładnie 1.0 → `dt / 0`, a czterech
  wartość ujemną → ładowanie leciało w tył i działo nie uzbrajało się nigdy.

**11. BUG: „nie mam CC" przy ulepszaniu reaktora w porcie.** Zgłoszone jako
losowe („w następnym porcie działało") — było w pełni deterministyczne.
Przycisk wyceniał się z `Reactor.upgradeCost()` = `10 + poziom*8` (LINIOWO,
relikt sprzed update30), a kasa liczyła `REACTOR_PRICE()` = wykładniczo.
Od 6. poziomu reaktora ceny się rozjeżdżają, więc przycisk świecił się jako
stać-Cię i odbijał zakup. „Następny port" działał dlatego, że gracz w międzyczasie
nazbierał CC ponad PRAWDZIWĄ cenę. `ui.js` woła teraz `s.reactorCost(ship)`
(istniało w `station.js` i nie miało ANI JEDNEGO wywołania), a `Reactor.upgradeCost()`
jest skasowany, żeby nie było czemu znowu się rozjechać. Dodatkowo w
`buyReactorUpgrade` test MAX idzie PRZED testem kasy — reaktor na maksie
zgłaszał brak CC, wysyłając gracza po pieniądze, których nie da się wydać.

**12. Znaleziona przy okazji martwa akcja:** przycisk **WELD** w hangarze rysował
wycenę, świecił się i wysyłał akcję `repairHull`, której `_act()` w ogóle nie
obsługiwał — klik grał dźwięk i nie robił nic. Dopisany case.

**Testy:** `run_tests.js` 1050 (nowe sekcje 67–77), `smoke_draw.js` 29,
`browser_test.js` 41 — w tym NOWA sekcja 4: prawdziwy sklep na stacji
(DOM, nie canvas), która sprawdza że każdy chip ma własne SVG i że
kwotowana cena reaktora ZAWSZE wystarcza na zakup. Każda nowa sekcja
zweryfikowana przez celowe zepsucie kodu (skrypt 14 psuć, każda złapana).
Sekcje 11 i 62 PRZEPISANE — kodowały starą decyzję („nikt nie stoi na środku
pokoju", „obwódka na `c.y-8`"), która jest teraz odwrotna.

## 5-0bv. ZMIANY update33 (magazyn bazy jako prawdziwa siatka)

Pierwszy etap TODO z §6 „magazyn w bazie jako SIATKA" — dotąd ładunek, którego
nie dało się rozpoznać jako He2/rakiety/broń, przy dokowaniu był **zawsze
automatycznie spieniężany** (`_dockAtBase` w game.js, komentarz wprost mówił
„next step — see HANDOFF §6"). Teraz ma gdzie wylądować.

**1. `base.js`: nowa, trwała `CargoGrid` — „półka" (`stash`).** He2/rakiety
zostają na starych, prostych licznikach (`warehouse.fuel/missiles`) —
NIE ruszane, zero ryzyka dla istniejącej arytmetyki `launch()`/`pruneHold`.
Wszystko INNE (apteczki, relikty, kontrabanda, rdzenie, jaja pająków…) leci
teraz na osobną siatkę:
- `Base.stashGrid()` — zwraca ŻYWĄ `CargoGrid` (deserializacja z zapisu za
  każdym razem), automatycznie POSZERZANą (nigdy zwężaną) do bieżącego
  uprawnienia kolumn.
- `Base.commitStash(grid)` — zapisuje z powrotem.
- `Base.stashCols()/stashRows()` — start 5×4 (20 kratek); **to samo
  ulepszenie WAREHOUSE**, które dotąd poszerzało tylko licznik He2/rakiet,
  teraz DOKŁADA też kolumnę na półce (jedna waluta ulepszeń, nie druga).
- Stary zapis bez klucza `stash` migruje do pustej siatki przez ten sam
  mechanizm forward-compat co reszta `Base.get()` (nic dodatkowego pisać
  nie trzeba było — działa z automatu).

**2. Dokowanie (`game.js _dockAtBase`).** Pętla po `hold.items` ma teraz
gałąź: cokolwiek nie jest fuel/missiles/weapon próbuje wejść na półkę
(`shelf.autoPlace(it)`); **dopiero gdy się nie zmieści**, leci sprzedaż za CC
jak dawniej (fallback, nie domyślne zachowanie). Komunikat w UI mówi osobno
„N przedmiotów na półce" i „nadwyżka sprzedana za X CC".

**3. Nowa zakładka WAREHOUSE w bazie** (`basescreen.js`, `TABS` ma teraz 6
pozycji). Panel czyta `Base.stashGrid()` GRUPUJĄC po `defKey`+uszkodzeniu
(dziesięć apteczek to jeden wiersz, nie dziesięć), pokazuje zajęte
kratki/pojemność i szacunkową wartość, przycisk **OPEN WAREHOUSE** otwiera
prawdziwy ekran siatki.

**4. `lootscreen.js`: nowy, OPT-IN przycisk SELL.** Tylko ekrany, które
podają `_opts.onSell`, go dostają (żadne istniejące wywołanie
`openLoot`/`openHold` tego nie robi — wrak/pakowanie/własna ładownia są
1:1 nietknięte). Sprzedaż liczy `it.value(portType)`, usuwa przedmiot,
płaci przez callback. Dodano też `_opts.holdLabel` (domyślnie nadal
„YOUR HOLD") żeby ekran magazynu mógł podpisać prawą siatkę poprawnie.
Ekran WAREHOUSE (`game.js _openWarehouseScreen`) używa `LootScreen.openHold`
w trybie jednej siatki; USE na apteczce w bazie świadomie odmawia („No
patient to treat here") zamiast cicho nic nie robić — nie ma tu za kogo
leczyć (załoga siedzi w koszarach, nie na statku).

**5. ŚWIADOMIE POZA ZAKRESEM (następny krok):** półka NIE jest jeszcze
częścią ekranu PACK HOLD — nie da się (jeszcze) spakować rzeczy z magazynu
na kontrakt, można je tylko oglądać/sprzedawać w zakładce WAREHOUSE. Scalenie
obu siatek w jednym ekranie pakowania to kolejny etap (patrz §6) — rozważano
to w tej paczce, ale wymagało bezpiecznego dzielenia jednej żywej siatki
między dwoma miejscami bez ryzyka duplikacji (klasa bugów, która w tym
projekcie już nieraz bolała — broń, amunicja, `consolidate()`), więc
zostawione na osobną, przetestowaną partię.

**6. PUŁAPKA ZASTANA (nie moja): folderu `tests/` NIE BYŁO w repo.**
`glowne/tests/run_tests.js` istniał, ale `require('./harness.js')` wskazywał
donikąd — `harness.js`/`smoke_draw.js`/`browser_test.js` nie były
zacommitowane NIGDY w top-level `tests/` (git log to potwierdza). Odtworzone
z historycznych paczek `glowne/moonwars-updateN.zip` (harness.js i
smoke_draw.js ostatnio zmieniane w update28, browser_test.js w update27;
nowsze paczki ich nie ruszały, więc się nie pakowały). Po odtworzeniu:
825/25/22 — dokładnie zgodne z tym, co HANDOFF deklarował dla update32,
więc rekonstrukcja jest wierna. **Ta paczka zawiera cały folder `tests/` —
rozpakuj go i zrób `git add tests/` (nie tylko `js/`), inaczej problem
wróci przy następnej sesji.**

**Testy:** 846 asercji w run_tests.js (+21, sekcje 64-66: siatka/migracja/
ulepszenie, dokowanie odkłada zamiast sprzedawać, pełna półka nadal sprzedaje
nadmiar), 27 kroków w smoke_draw.js (+2: zakładka WAREHOUSE pusta/zatowarowana,
przycisk SELL w LootScreen + sprawdzenie że BEZ `onSell` przycisk nie istnieje),
26 w browser_test.js (+4: wszystkie 6 zakładek, w tym ARMOURY które wcześniej
w ogóle nie było klikane pod właściwym opisem — stare współrzędne po cichu
trafiały w sąsiednią zakładkę odkąd libka miała 5 kart; teraz sprzedaż
w prawdziwej przeglądarce z realnym Playwright-canvasem). Wszystkie trzy nowe
sekcje logiki sprawdzone celowym psuciem kodu (wyłączona gałąź „shelf" →
2 błędy w sekcji 65; wyłączony fallback sprzedaży przy pełnej półce →
1 błąd w sekcji 66).

## 5-0bw. ZMIANY update32 (kolory ładowania, reaktor jako moduł, przebudowa UI bazy)

**1. Kwadraciki ładowania w kolorze broni.** `Renderer.weaponStyleColor(key, type)` zwraca
kolor ze stylu danej broni; `Weapon.draw` i karty w HUD używają go zamiast stałej czerwieni.
Jonowa ładuje się fioletem, flak żółcią, laser czerwienią. `_lighten/_darken` w weapons.js
robią wariant „naładowane".

**2. Reaktor to zwykły moduł.** Zniknęła pomarańczowa szyna łącząca reaktor z modułami
(i pionowe odnogi), a kolumna reaktora z lewej krawędzi została USUNIĘTA. Reaktor stoi teraz
PIERWSZY w rzędzie modułów: ta sama obwódka, te same pipsy (zapalone = wolna moc), etykieta
`REACTOR free/rated`, i **klik w ikonę SCRAMUJE cały reaktor** (`reactor.offline`).
`Reactor.totalPower` zwraca 0 gdy offline; `ratedPower` to moc bez scramu (do odczytu).
Uwaga na mgławicę: notka `NEBULA −N` wisi teraz pod ikoną reaktora.

**3. Karty broni w HUD.** Sprite broni + nazwa + `⚡koszt` + **kwadraciki sekund** w kolorze
broni (szerokość karty rośnie z czasem ładowania), plus `Ns` w rogu.

**4. Hangar 1:1.** Pasek modułów przeniesiony ze ŚRODKA pod kartę statku w prawej kolumnie —
dzięki temu na kadłub zostaje cała wysokość panelu i **nic nie jest skalowane**
(`ctx.scale` i napis „shown at N%" usunięte). Kadłub jest centrowany 20px niżej, żeby lufy
nie wchodziły na linię statystyk. Test pilnuje, że skalowanie nie wróci.

**5. Armoury z grafiką.** Każdy mount i każdy wiersz regału ma sprite broni w jej kolorze,
nazwę w tym kolorze i `_chargeStrip` — puste kwadraciki, jeden na sekundę ładowania.

**6. SUPPLY przebudowane.** Trzy karty: He2 (ikona zbiornika, stan magazynu, suwak baku,
sklep), MISSILES (ikona regału z pociskami — bez suwaka, bo jadą w ładowni) oraz
**THIS LAUNCH** — podsumowanie tego, co faktycznie leci (bak, He2 w ładowni, rakiety, działa,
zajęte kratki) z przyciskiem PACK HOLD.

**7. UPGRADES z piktogramami.** Rysowane ikonki: skrzynie (magazyn), prycza (koszary),
hangar z kadłubem (miejsce postojowe), siatka zyskująca kolumnę (retrofit ładowni).

**8. Zaznaczenie załogi.** Płaska elipsa pod butami (czytała się jak cień) zamieniona na
CIENKI pierścień wokół postaci — linia 1px plus druga, słabsza obwódka tuż obok.

**Testy:** 825 asercji w 62 sekcjach. Nowe sekcje 59-62 sprawdzone celowym psuciem
(jeden kolor dla wszystkich broni → 1, reaktor bez scramu → 2, powrót skalowania → 1,
powrót elipsy → 1).

## 5-0bx. ZMIANY update31 (jaja we wrakach, sprite'y pająków, grafika broni, nazwy egipskie)

**1. ZGŁOSZONY BUG: „widzę ludzi we wrakach".** `CrewMember` w konstruktorze robił
`this.anim = Animation.crewIdle(!isPlayer)` BEZPOŚREDNIO, więc `_animState` zostawało
`undefined`, a `_setAnim()` (który zna pająki) odpalał dopiero przy ZMIANIE stanu.
Pająk, który po prostu stał, do końca miał sprite wrogiej załogi. Teraz konstruktor
przechodzi przez `_setAnim('idle')`.

**2. Wraki zaczynają od JAJ.** `populateDerelict` wsadza pająki z `dormant = true`
i `hatchT` (stagger). `CrewMember.update` przy `dormant` wychodzi natychmiast (nie rusza się,
nie walczy), a `draw` rysuje `Animation.drawEggSac()`. Nowe `Ship.hatchNests(dt)` (wołane
z `update` gdy `isDerelict`): sac w pokoju z intruzem pęka NATYCHMIAST (6x szybszy licznik),
reszta na własnym timerze — dzięki temu drużyna nigdy nie utknie przez jajo w pokoju,
do którego nikt nie zajrzał. Bez abordażu wrak jest cichy w nieskończoność.

**3. Śluzy animowane tak jak drzwi wewnętrzne.** Logika już była wspólna (openness), ale
`draw` śluzy miała własną, binarną gałąź. Teraz dwa skrzydła rozjeżdżają się, bursztynowe
w ruchu, czerwona poświata proporcjonalna do szczeliny.

**4. Każda broń ma własną sylwetkę.** `WEAPON_STYLE` w renderer.js — klucz to DEF broni,
nie typ. `rail` (1-3 emitery), `heavy`, `pods`, `coil`, `drum`, `howitzer`, `emitter`.
Trzy lasery różnią się liczbą emiterów i kształtem. Test pilnuje, że żadne dwie bronie nie
mają tej samej trójki (forma, lufy, kolor).

**5. Ładowanie w KWADRACIKACH.** Jeden na sekundę: broń 9 s = 9 pudełek, zapełniają się
po jednym, na czerwono. `CHARGE_BOX_W = 5`, `CHARGE_BOX_GAP = 1` — pudełka mają STAŁY
rozmiar, więc pasek rośnie zamiast ściskać się do 1 px (18-sekundowe działo było nieczytelne).
`Weapon.chargeStripWidth()` używa `_drawWeaponMounts` do rozstawiania dział, żeby paski
sąsiadów nie wchodziły na siebie. Działa odsunięte od kadłuba (b.y − 42).

**6. Pociski laserów CZERWONE.** Sprite `proj_laser` jest niebieski, więc bolt rysowany jest
ręcznie (gradient czerwony + poświata); błysk wylotowy też.

**7. Szyby wind przerysowane** — gradientowy trzon, szczebelki, prowadnice, płyty
przystankowe z lampką (zielona gdy kabina stoi), lina nośna i szew drzwi kabiny.

**8. Hangar: zarezerwowany pas na dole.** Kadłub jest SKALOWANY w to, co zostaje
(`shown at N%`), przy czym do wysokości layoutu doliczane jest 52 px na działa nad
poszyciem. Napisy o załodze i naprawie leżą w JEDNYM rzędzie (załoga z lewej, HULL/WELD
z prawej) — wcześniej trzyipółdeckowy Horus wchodził na listę modułów, a teksty na siebie.

**9. Nazwy statków — wyłącznie bogowie egipscy.** Bastet (tug), Hapi (frachtowiec),
Horus (trójpokładowiec), Set / Sobek / Anubis (wrogowie), Apophis (boss, kontrakt
„Strike on Apophis"). Test pilnuje, że każdy layout i każda pozycja w stoczni ma imię
z listy i że się nie powtarzają.

**Testy:** 799 asercji w 63 sekcjach. Nowe sekcje 59-63 sprawdzone celowym psuciem
(sprite pająka z konstruktora → 2 błędy, jaja od razu wyklute → 4, śluzy natychmiastowe → 3,
identyczne lasery → 1, ściśnięte pudełka ładowania → 1).

## 5-0by. ZMIANY update30 (bilans modułów, drzwi na czas, grafika broni, naprawa w bazie)

**1. Osłony startują z 2 pipsami.** `SYSTEM_DEFS.shields.startLevel = 2`, a `addModule`/
`addModuleAt` czytają `startLevel ?? 1`. Poziom osłon liczy PIPSY (2 = jedna warstwa),
więc świeżo kupiony generator na poziomie 1 miał pół warstwy i nie mógł podnieść niczego.

**2. Ceny ulepszeń rosną wykładniczo.** `UPGRADE_GROWTH = 1.22` w station.js.
`REACTOR_PRICE(l) = round((10 + l*4) * 1.22^max(0, l-3))` — lvl 5: 30 CC, lvl 10: 201 CC,
lvl 15: 761 CC. `systemUpgradeCost` tak samo (dla osłon po WARSTWACH, nie po pipsach).
Człon liniowy trzyma wczesne ulepszenia tanio; krzywa gryzie dopiero u góry.

**3. Drzwi cyklują 1 sekundę.** `DOOR_CYCLE = 1.0`, `Door.openness` 0..1, a `door.open`
oznacza teraz W PEŁNI OTWARTE. `requestPassage()` prosi o otwarcie i **zwraca false**,
dopóki panel jedzie — załoga nie przeciśnie się przez półotwarte drzwi.
`toggle()` przestawia tylko `mode`; kto pisał `d.open = ...` (game.js: `_setAllDoors`,
abordaż) musi teraz ustawiać `mode`/`breached`, bo `open` jest wyliczane w `update()`.
Rysowanie: dwa skrzydła rozjeżdżają się na boki, bursztynowe gdy w ruchu.

**4. Grafika broni.** `Renderer.drawWeaponIcon(ctx, type, x,y,w,h, {dir, powered})` —
jedna procedura dla lasera / rakiet / jonu / działa / flaka / bela, plus
`Renderer.weaponIconURL(type)` (offscreen canvas → dataURL, cache) dla paneli DOM.
`Weapon.draw` rysuje sprite + pasek ładowania POD nim. `_drawWeaponMounts` układa działa
W POZIOMIE NA GÓRZE kadłuba (były pionowym stosem odklejonym od dziobu), obrócone w stronę
przeciwnika (`dir`).

**5. Ikony i pipsy modułów NA STATKU.** `ShipSystem.draw` dokleja w lewym górnym rogu
pokoju glif modułu, a w prawym — JEDEN PIPS NA SLOT MOCY (zielony = zasilany,
czerwony = rozwalony). Patrząc na kadłub widać co i na jakim poziomie.

**6. Hangar czyta PRAWDZIWE poziomy.** Stary `_entryLevels` chodził po pokojach i indeksował
`entry.data.systems` równolegle — te kolejności NIE pokrywają się na kadłubach z kilkoma
pokojami tego samego typu, więc trzy wyrzutnie pokazywały poziom z layoutu. Teraz
`_entryShip(entry)` **materializuje prawdziwy Ship** (cache po sygnaturze) i czyta
`ship.systems`. Pipsy = poziom (max 8 rysowanych + "+N"), plus linijka
"reactor N power · M slots to fill".

**7. Pająki naprawdę nie obsługują wraku.** Zostało jedno miejsce: AI załogi wroga w
`combat.js` (`pickBest`) rozdawało im naprawy i gaszenie pożarów. Teraz `!c.isSpider`
także tam, i w teście `inRoom`.

**8. Ikona zarazy na ROSTERZE.** Była nad imieniem na statku, gdzie ginęła w tekście.
Teraz siedzi przy gwiazdce w liście załogi (☣ + licznik walk do śmierci); na statku
zostaje sam pierścień.

**9. Salwy.** `laser_burst` 12→14 s ładowania i `burstGap: 0.42`, `flak_basic` 8→10 s
i `0.38`. Domyślny `burstGap` 0.16 → 0.35.

**10. Naprawa kadłuba w bazie.** `Base.hullRepairQuote(idx)` / `Base.repairHull(idx)`,
`HULL_REPAIR_PRICE = 4` CC/punkt (drożej niż w porcie). Przycisk WELD IT pod statkiem
w hangarze. Fabrycznie nowy wpis (`data: null`) jest materializowany przed naprawą.

**Testy:** 752 asercje w 58 sekcjach. Nowe sekcje 52-58 sprawdzone celowym psuciem
(osłony na lvl 1 → 2 błędy, liniowe ceny → 3, drzwi natychmiastowe → 2, pająki naprawiające
→ 1, wąski odstęp salwy → 2).

## 5-0bz. ZMIANY update29 (broń tylko w mount albo w skrzyni, kolory korporacji, martwe wraki, hangar)

**1. Broń: BOLTED ON albo BOXED, nic pomiędzy.** Był bug — dało się zrobić UNBOX i mieć broń
"w powietrzu", bez zajmowania miejsca.
- `_unpackCargo` dla `kind:'weapon'` **montuje** broń w wolnym mouncie; brak wolnego = odmowa
  i skrzynia zostaje. Skrzynię usuwa TAM (nie tylko w LootScreen), inaczej inny wywołujący
  zamontowałby broń i zostawił pustą skrzynię.
- `Station.uninstallWeapon()` pakuje zdjętą broń do SKRZYNI w ładowni (`Ship.boxWeapon`).
  Brak miejsca = broń zostaje na kadłubie (komunikat), nie znika.
- W stacji zniknął przycisk "UNBOX ONTO RACK"; jest "UNBOX & FIT → BAY N", zablokowany gdy
  nie ma wolnego mountu. `weaponCargo` zostaje TYLKO jako legacy dla starych save'ów.

**2. Kolory korporacji.** Dwa osobne błędy:
- `serialise()` NIE zapisuje `color`, a zakładka CREW w bazie czyta prosto z save'a — Terra
  dostawała domyślny niebieski. Nowy helper **`crewColor(c)`** (crew.js) liczy kolor z
  `CORP_DEFS[c.race]` i działa na żywym CrewMember ORAZ na surowych danych. Użyty w
  basescreen, renderer i ui.
- `crewByColor()` obsługiwał tylko walk/idle — repair/fight/die szły przez generyczne
  niebieskie klatki, więc naprawiający zmieniał kolor. Teraz **wszystkie stany są keyowane
  kolorem**.

**3. Pająki mają własny sprite.** `_genSpider(color, mode)` w animation.js — niski, szeroki,
osiem nóg animowanych w przeciwfazie, karapaks, świecące oczy, kły przy ataku.
`Animation.spiderAnim(mode, color)`; `_setAnim` przekierowuje pająki zanim dojdzie do switcha.

**4. Pająki NIE obsługują wraku.** Dwa miejsca trzeba było uszczelnić:
`ship.js` (pętla auto-zadań + `assignStations`) ORAZ `crew.js` `case TASK.IDLE` — to drugie
samo przydzielało sobie naprawę modułu w pokoju, więc pająki "naprawiały" wrak.

**5. Wraki są naprawdę martwe.** `makeDerelict`: KAŻDY moduł `damagedLevels = level` i 0 mocy.
Wyjątek to tlen — `ship.o2Alive` (70% szans) zostawia sprawny O2 na własnych ogniwach;
jak nie, poziom tlenu w pokojach spada do 15-45% (trzeba się liczyć z duszeniem).
Nowe `igniteDerelict(ship, sector)` — 45% szans, 1-3 pożary do ugaszenia. Oba fakty
są komunikowane po zadokowaniu.

**6. Hangar przebudowany.** Stocznia PO LEWEJ, twoje berthy PO PRAWEJ, wybrany statek w pełnym
rozmiarze na środku. Miniaturki mają **prawdziwe ikony modułów** (wspólna tablica
`SYSTEM_GLYPHS` + `Renderer.systemGlyph()` — ta sama co pasek energii) zamiast literek,
plus paski poziomu na dole każdego pomieszczenia i `+` w pustych wnękach.
Pod statkiem `_moduleStrip()` — ikona, nazwa i pipsy poziomu każdego modułu.
`_entryLevels(entry)` wyciąga poziomy z save'a hulla.

**Testy:** 693 asercje w 54 sekcjach. Nowe sekcje 52-54 sprawdzone celowym psuciem
(fallback koloru → 2 błędy, repair bez koloru → 1, sprite pająka = sprite załogi → 1,
zdejmowanie broni na rack → 3).

## 5-0ca. ZMIANY update28 (dokowanie, wraki po których się chodzi, pająki i wirus)

**NOWY PLIK `js/wreck.js`** — dokowanie i derelikty. Ładowany PO `lootscreen.js`,
dopisany do `LATE_MODULES` (samonaprawa starego index.html) i do `LOAD_ORDER` w harness.

**1. Minigra dokowania (`DockingGame`).** Znacznik jeździ po pasku, trzeba go zatrzymać
w zielonym polu (klik albo SPACE). Trwa sekundy i **nigdy nie blokuje** — zawsze jest
AUTO-DOCK (kosztuje 1 He2) i BREAK OFF. Wynik ma znaczenie (`DOCK_OUTCOMES`):
`perfect` +15 s na zegarze przeszukania, `ok` nic, `bad` −8 s i 2 kadłuba, `auto` −1 He2.
Im głębszy sektor, tym węższe zielone pole i szybszy znacznik.

**2. Wraki, po których się chodzi.** `makeDerelict(sector)` buduje PRAWDZIWY `Ship`
z layoutu wroga: bez broni, bez zasilania, kadłub 25-55%, większość modułów rozwalona,
`isDerelict = true`. `populateDerelict()` wsadza do niego gniazdo pająków.
`_startWreckBoarding()` odpala `CombatManager.begin()` z tym wrakiem — dzięki temu
**cały istniejący stos abordażowy działa bez zmian**: BOARD, walka wręcz pokój po pokoju,
tlen, pożary, RECALL. Wrak nie strzela (0 broni), nagroda CC = 0, `weaponDrop` = null.
Gdy zginie ostatni pająk, `_updateCombat` woła `_wreckCleared()` → ekran łupu BEZ dialogu.
Eventy `dockWreck` idą teraz: event → `_beginDocking` → `_startWreckBoarding` → łup.

**3. Pająki i wirus.**
- `CORP_DEFS.spider` (NIE w `CORP_KEYS` — nie da się ich najmować), `crew.isSpider`,
  `makeSpiders(n, tough)`.
- `CrewMember.strike(target, dmg)` — JEDNO miejsce, przez które idzie walka wręcz
  (oba miejsca w crew.js zostały przekierowane). Tylko tam pająk może zarazić
  (`SPIDER_INFECT_CHANCE = 0.35`).
- **UWAGA: flaga to `virus`, NIE `infected`.** `infected` to STARA zaraza trupia
  (ship.js zaraża przy zwłokach, klinika ją leczy za 12 CC). Gdyby wirus pajęczy
  używał tej samej flagi, każda klinika leczyłaby go za grosze i cała mechanika
  by zniknęła. Testy pilnują rozdzielności.
- Cykl: ugryzienie → `virus` → po `VIRUS_FIGHTS_TO_DEATH` (3) walkach `killOutright()`
  (nowa metoda: bez rzutu na "ranny", bez animacji konania) → do ładowni wpada
  `spider_egg` z `meta = EGG_FIGHTS_TO_HATCH` (3) → po 3 walkach jajo pęka i **1-3 pająki
  są luzem na TWOIM statku**. Wszystko w `_tickInfections()`, wołanym po każdej walce.
- `_playerCrewAliveCount()` liczy teraz TYLKO `c.isPlayer` — inaczej statek pełen pająków
  po wybiciu załogi wyglądałby na "wciąż obsadzony".
- Leczenie: **tylko port `science`** — `Station.cureVirus()` / `quarantineCost()` (45 CC
  za głowę), nowa karta ☣ QUARANTINE WARD w zakładce REPAIR. W innych portach karta
  tłumaczy, że nie ma tu warunków.

**4. Zgłoszone poprawki UI.**
- **Przyciski gasły, zanim się do nich dojechało**: zaznaczenie w ekranie łupu było
  hover-only. Teraz jest LEPKIE — przedmiot zostaje zaznaczony aż wskażesz inny albo
  zniknie z ładowni.
- `JETTISON` → **`THROW OVERBOARD`** (+ komunikat "gone for good"), bo "jettison" nic
  nie mówiło.
- **UPGRADES w bazie**: były 2 rzędy kart, które wychodziły poza panel i nadpisywały
  napisy. Teraz CZTERY kolumny w jednym rzędzie, `_wrap()` ZWRACA y ostatniej linii,
  a przycisk jest przyklejony do dołu karty — tekst nie ma jak na niego wejść.
- **HANGAR**: wybrany statek jest budowany jako prawdziwy `Ship` i rysowany
  W PEŁNYM ROZMIARZE na środku, z wybraną załogą w środku (`_previewShip()`, cache po
  `shipIdx|key|picked`). Listy berth/stocznia zjechały do wąskiej kolumny po lewej,
  a teksty są przycinane (`_clip`), żeby nie łaziły pod miniaturkę.

**Testy:** 657 asercji w 51 sekcjach, 25 kroków rysowania, 22 w przeglądarce.
Nowe sekcje 47-51 sprawdzone celowym psuciem (brak zarażania → 2, klinika lecząca wirusa
→ 1, jajo które nie pęka → 2, stała szerokość zielonego pola → 1).
**Pułapka:** sekcja 47 najpierw CRASHOWAŁA zamiast failować (ugryziony umierał, a
`Save.addToGraveyard` leciało na null) — dlatego `grep FAIL` nic nie pokazał.
Przy deliberate-break check zawsze patrzeć na OGON wyjścia, nie tylko na FAIL.

## 5-0cb. ZMIANY update27 (łączenie stosów, skrytka na broń, winda po abordażu)

**1. ŁĄCZENIE STOSÓW.** `CargoGrid.canMerge(src,dst)` / `CargoGrid.merge(src,dst)` (statyczne) —
ten sam `defKey`, oba stosy, oba nieuszkodzone, cel ma miejsce. `merge` przelewa
`min(dst.room, src.qty)` i ZWRACA ile przeszło; resztę zostawia w źródle.
W `lootscreen.update` upuszczenie NA inny pojemnik tego samego typu robi merge (sprawdzane
PRZED zwykłym `fits`); jak cel się zapełni, reszta wraca na stare miejsce.
Nowy przycisk **TIDY** woła `grid.consolidate()` (aktywny tylko gdy jest co łączyć).

**PUŁAPKA złapana przez test:** pierwsza wersja `consolidate()` iterowała po KOPIACH
`[...this.items]` i przelewała resztki do pojemników, które już zostały usunięte z siatki —
trzy apteczki po 3/4/2 dawki "konsolidowały się" do ZERA. Konieczne są guardy
`this.items.includes(dst)` i `includes(src)` w obu pętlach.

**2. ZGŁOSZONY BUG: winda po abordażu.** `ElevatorShaft.board()` ustawia `crew._ridingShaft`
i `shaft.passenger`. Jak wysłałeś abordaż, gdy ktoś był W KABINIE, opuszczał statek z tymi
flagami. Po powrocie `if (this._ridingShaft) return;` w obsłudze waypointu = stał przy szybie
w nieskończoność, a `shaft.passenger` dalej wskazywał na niego, więc **nikt inny też nie mógł
wezwać windy**. Naprawa: `ElevatorShaft.release(crew)` + `ElevatorManager.release(crew)`,
wołane w `_makeParty` (przy wyjściu) i w `_returnBoarder` (przy powrocie, dla OBU statków),
plus zerowanie `_ridingShaft`/`_elevatorArrived`/`_pathRetryCd`.

**3. Zdobyta broń → SKRYTKA.** `_queueWeaponLocker(defKey)` zamiast `weaponCargo.push` przy
`CombatManager.weaponDrop`; `_updateMap` otwiera `_openWeaponLocker()` dopiero gdy walka się
rozwinie (STATE='map'). Skrytka to mała siatka z jedną skrzynią — trzeba fizycznie znaleźć
miejsce, a co zostanie w skrytce **przepada** (komunikat).
Most stacja↔ładownia w `ui.js`: przy wolnej wnęce jest **UNBOX & FIT** dla skrzyń z ładowni,
na regale **BOX INTO HOLD**, a skrzynie z ładowni mają **UNBOX ONTO RACK**. Bez tego skrzynia
z wraku nie miała jak trafić na kadłub.

**4. Rakiety w HUD zawsze = rakiety w ładowni.** `_syncAmmo()` pisze TYLKO gdy się różnią
(`Save.updateRun` dotyka localStorage), więc jest wołane co klatkę w stanach map/combat/loot/
station/event. Dodatkowo `countOf()` **pomija uszkodzone stosy** — `takeStack()` i tak z nich
nie bierze, więc liczenie ich obiecywało amunicję, której działa nie wystrzelą.

**Testy:** 603 asercje w 46 sekcjach, 22 w przeglądarce. Nowe sekcje 43-46; sprawdzone
celowym psuciem (brak merge przy dropie → 1, liczenie uszkodzonych → 2, brak release windy → 2).
Testy klikają teraz przyciski ekranu łupu **po nazwie** (`LootScreen._zoneFor('takeAll')`),
bo dodanie TIDY przesunęło cały rząd i stare współrzędne trafiały w zły przycisk.

## 5-0cc. ZMIANY update26 (STOSY: ilość JEST przedmiotem)

**1. Przedmioty mają ILOŚĆ, nie są tokenami do sprzedania.**
`CargoItem` ma `qty`, def ma `stackMax`. Nowe defy:
- `missile_rack` 3 kratki, max 10 rakiet — **11 rakiet = dwa regały = 6 kratek** (przykład użytkownika).
- `he2_small` 1 kratka/5, `he2_med` 2 kratki (1x2)/15, `he2_large` 4 kratki (2x2)/50.
- `medkit` 1 kratka/10 dawek, `healPerDose: 25`.
- Stare `he2_canister`/`he2_drum`/`missile_crate` ZOSTAJĄ w katalogu wyłącznie dla starych save'ów.

`CargoGrid.addStack(key, n)` — najpierw DOPEŁNIA częściowe stosy, potem kładzie nowe, dopóki
się mieszczą; **zwraca ile się NIE zmieściło** (ładownia to realne ograniczenie).
`takeStack(kind, n)` — zdejmuje od NAJMNIEJSZYCH stosów, żeby ładownia sama się defragmentowała.
`countOf(kind)` — suma sztuk. Cena stosu = `unitValue * qty`.

**2. Rakiety: ładownia jest JEDYNYM źródłem prawdy.**
`combat.playerFire` zdejmuje sztuki bezpośrednio z regałów (`takeStack`), a `run.missiles` jest
tylko LUSTREM (HUD + stare save'y) — synchronizowane przez `_syncAmmo()`. Nie ma już
"auto-rozpakowania skrzyni" z update25, bo nie ma czego rozpakowywać.
`_addMissiles(n)` (eventy, stacja) zwraca `{loaded, spilled}` — jak nie ma miejsca, mówi wprost.
`Station.buyMissiles(n, run, ship)` robi PRÓBNY załadunek na kopii siatki i **liczy CC tylko za
to, co się zmieści**.

**3. Otwieranie i używanie.** Przycisk zmienia napis wg zawartości: `POUR INTO TANK` (całość He2
do baku), `USE A DOSE` (jedna dawka, reszta ZOSTAJE — `consumed:false`), `UNBOX GUN`.
Regał rakiet nie ma czego otwierać (wyrzutnie karmią się z niego w miejscu).

**4. Zgłoszony bug: broń dublowała się w ładowni.** Zdejmujesz broń z kadłuba → trafia do
zbrojowni → na PÓŁCE BAZY pojawia się skrzynia. Zakładasz z powrotem → skrzynia zostawała na
półce (a jak ją wcześniej wrzuciłeś do ładowni, leciała z tobą = broń dwa razy).
Przyczyna: `_store` był budowany tylko w `_buildHold()`/przy suwaku He2, a NIE po fit/unfit/
sellGun/buy/upgrade/buyShip/sellShip. Naprawa: `_syncStore()` po KAŻDEJ takiej akcji +
`Base.pruneHold(hold, reserveFuel)`, który wyrzuca z zapakowanej ładowni wszystko, czego baza
już nie ma (broń bez odpowiednika w zbrojowni, nadmiar He2/rakiet) i **mówi co zabrał**.
`pruneHold` leci też tuż przed `launch`.

**5. Nowe ulepszenie bazy: CARGO RETROFIT** (`kind: 'hold'`, cena `100 + lvl*110`).
`Base.holdBonus()` = `holdLvl`, doliczane do `cargoCols` KAŻDEGO kadłuba w `_buildHold()`.
Karty ulepszeń układają się teraz 2x2 (czwarta nie mieściła się w rzędzie).

**6. Mniej łupu we wrakach** (na prośbę użytkownika): siatka wraku 3-5 x 3-4 (było 4-7 x 3-5),
liczba losowań 2..4+sektor/2 (było 4..8+sektor), wagi rzadkich rzeczy w dół. Stosy z wraku są
CZĘŚCIOWO ZUŻYTE (1..70% pojemności) — test pilnuje, że większość jest niepełna.

**Testy:** 569 asercji w 42 sekcjach. Nowe sekcje 38-42 sprawdzone celowym psuciem
(brak dopełniania stosów → 1 błąd, medkit zawsze zużywany → 1, brak `_syncStore` → 1).

## 5-0cd. ZMIANY update25 (amunicja i broń w ładowni, salwy, więcej wraków)

**1. Rakiety i broń zajmują miejsce w ładowni.**
- `cargo.js`: trzy tiery skrzyń z bronią — `gun_crate_s` 2x2 (≤50 CC), `gun_crate` 3x2 (≤75 CC),
  `gun_crate_l` 3x3 (drożej). Wybiera je `cargoCrateForWeapon(defKey)`. Cena skrzyni = 60% ceny
  sklepowej broni (a nie stała liczba).
- `base.js`: `storeGrid(reserveFuel)` buduje siatkę 8x6 z tym, co baza może wydać — He2 w
  kanistrach po 3, rakiety w skrzyniach po 4, każda broń ze zbrojowni jako skrzynia właściwego
  rozmiaru. `holdCost(hold)` liczy rachunek; `launch({hold})` odejmuje go z magazynu/zbrojowni
  i ZWRACA `hold` w loadoucie. Jeśli magazyn nie pokrywa spakowanego — skrzynie są zdejmowane
  od końca, nie tworzone z powietrza.
- `basescreen.js`: przycisk **PACK HOLD** przy manifeście kontraktu; `packGrids()` oddaje
  `{store, hold}`. Zmiana statku PRZEBUDOWUJE ładownię (co się nie mieści, wraca na półkę).
  Suwak rakiet USUNIĘTY — rakiety jadą wyłącznie w skrzyniach. He2 ma nadal suwak, bo to
  paliwo w baku, nie ładunek (kanistry to zapas ekstra i konkurują z bakiem o ten sam magazyn).
- `game.js`: `_openPackScreen()` otwiera LootScreen w trybie bazy (bez zegara, LOAD ALL zamiast
  TAKE ALL); `_startContract` wstawia spakowaną ładownię na statek i **od razu rozpakowuje jedną
  skrzynię rakiet**, żeby wyrzutnia nie startowała pusta.
- `combat.js`: gdy wyrzutnia chce strzelić, a w regale 0 rakiet — załoga AUTOMATYCZNIE otwiera
  skrzynię z ładowni (komunikat). Bez tego trzeba by wychodzić z walki, żeby rozpakować.

**2. Salwy strzelają po kolei.**
`laser_burst` i `flak_basic` mają `shots: 3` od dawna, ale wszystkie pociski powstawały w tej
samej klatce, w tym samym punkcie — nakładały się i wyglądały jak JEDEN strzał. `Projectile`
dostał `launchDelay`; `Weapon.fire()` ustawia `i * (def.burstGap ?? 0.16)`. Pocisk czekający
w tubie NIE porusza się i NIE jest rysowany, a w momencie startu dostaje własny dźwięk i błysk.

**3. Więcej wraków do dokowania.**
- `map.js`: waga węzła `event` 3 → 5, `empty` 2 → 1. Stary `abandoned_ship` (płaski scrap)
  zamieniony na dokowanie; dołączyły `frozen_freighter` (70 s), `mining_barge` (34 s, `hazard`)
  i `quarantined_hauler` (45 s, `rich` = większa i bogatsza ładownia).
- `game.js`: `_openWreckLoot(sector, opts)` przyjmuje `returnTo` ('combat' po walce / 'map' po
  evencie), `seconds`, `rich`, `title`. Nowa gałąź `result.dockWreck` w `_resolveEvent`.

**4. Layout ekranu łupu skaluje się do siatki.** Siatka bazy 8x6 wchodziła pod panel opisu.
`_cell()` liczy rozmiar komórki tak, żeby NAJWYŻSZA z dwóch siatek zmieściła się między
`GRID_TOP` a `GRID_BOT`. Test to sprawdza (`br.y + br.h <= 470`).

**Testy:** 513 asercji w 37 sekcjach, 23 kroki rysowania. Wszystkie 4 nowe sekcje sprawdzone
celowym psuciem kodu (brak stagger → 2 błędy, jeden rozmiar skrzyni → 2, brak odejmowania
z magazynu → 1, brak auto-rozpakowania → 2).

## 5-0ce. ZMIANY update24 (ładownia siatkowa + ekran łupu)

Pierwszy etap planu z `claude/roadmap-inventory-dokowanie.md`: łup przestał być rzutem kostką,
a stał się układanką.

**NOWY PLIK `js/cargo.js`** — model, zero rysowania i zero inputu:
- `CARGO_ITEMS` — katalog przedmiotów. `w`/`h` LUB `cells: ['##','#.','#.']` dla kształtów
  nieregularnych (maska jest źródłem prawdy o rozmiarze, nie w/h).
- `CargoItem` — instancja: `defKey`, `x`, `y`, `rot` (0-3), `meta` (gun_crate → defKey broni),
  `damaged`. `it.mask` = maska obrócona, `it.w/h` z maski. `value(portType)` liczy cenę.
- `CargoGrid` — `fits/place/remove/autoPlace/at/occupancy/neighbours/hazardTick/hasLiveHazard`,
  `serialise/deserialise`. `autoPlace` PRÓBUJE WSZYSTKICH 4 OBROTÓW.
- **Sąsiedztwo:** `unstable_core` (tag `rad`) psuje wszystko, czego dotyka — chyba że dotyka go
  `cooler_crate` (tag `cool`). Zepsuty przedmiot = 40% ceny i NIE da się rozpakować.
- **Kontrabanda:** port `military` płaci 0 i konfiskuje + 25 CC kary; `outpost` płaci x2.
- `makeWreckGrid(sector)` — generuje ładownię wraku (im głębiej, tym większa i bogatsza).

**NOWY PLIK `js/lootscreen.js`** — ekran, sterowany jak BaseScreen (`update(dt)` → `'done'|null`):
- `openLoot(wreck, hold, opts)` — dwie siatki + zegar; `openHold(hold, opts)` — sama ładownia.
- Drag&drop myszą, `R` obraca, przyciski ROTATE / TAKE ALL / UNPACK / JETTISON / DONE.
- Podgląd "ducha" pod kursorem: zielony = zmieści się, czerwony = nie.
- **Rysowanie przedmiotu to JEDNA sylwetka**, nie kafelki: komórki tego samego przedmiotu są
  zszywane przez GAP, a obrys idzie tylko po ZEWNĘTRZNEJ krawędzi. Bez tego dwie skrzynie
  w tym samym kolorze obok siebie wyglądały jak jedna plama.
- Etykieta ma ciemną podkładkę (inaczej gryzie się z liniami siatki).

**Integracja:**
- `Ship` ma `this.cargo` (CargoGrid). Rozmiar z layoutu: scout 5x3, frigate 6x4, hauler 7x5 —
  ładownia to teraz POWÓD, żeby kupić frachtowiec. `serialise()` zapisuje `cargo`,
  `deserialise()` czyta; **stary save bez klucza `cargo` ładuje się z pustą ładownią** (test!).
- `game.js`: STATE `'loot'`, `_openHold()`, `_openWreckLoot(sector)`, `_unpackCargo(item)`,
  `_updateLoot(dt)`. Przycisk **CARGO [C]** na mapie (3. rząd, pod przełącznikiem MAP/SHIP);
  robi się CZERWONY, gdy w ładowni tyka niechłodzony rdzeń.
- `_travelTo`: po odjęciu He2 leci `cargo.hazardTick()` — **źle spakowany ładunek psuje się
  DOPIERO PRZY SKOKU**, nie w trakcie stania. Wybór lane'u w sektorze 1 to nie skok (bez kary).
- "Przeszukaj wrak" (`searchDerelict`) NIE jest już rzutem kostką — otwiera ekran łupu.
  Ocalały z wraku i pułapka nadal są, ale dzieją się PRZED otwarciem ładowni (pułapka skraca
  zegar z 50 s do 32 s). Wrak ginie dopiero po `CAST OFF`.
- `ui.js`: nowa zakładka stacji **CARGO** — lista do sprzedaży (nie siatka; tu nie przepakowujesz,
  tylko decydujesz co schodzi ze statku). Ceny zależą od typu portu, jest SELL EVERYTHING.
- `_dockAtBase`: to, co zostało w ładowni, jest przy dokowaniu spieniężane (He2/rakiety wpadają
  do magazynu, broń na regał, reszta na CC). Docelowo magazyn bazy też ma być siatką — TODO §6.
- `index.html`: `cargo.js` PRZED `ship.js` (konstruktor Ship go używa), `lootscreen.js` po
  `basescreen.js`. Oba dopisane też do `LATE_MODULES` (samonaprawa starego index.html).

**Testy:** +5 sekcji (28-32) i +2 kroki rysowania; browser_test ma trzecią sesję, która
przeciąga skrzynię MYSZĄ po prawdziwym canvasie i sprawdza, że nie wypadła poza siatkę.
Pułapka złapana przy okazji: pierwszy test chłodziarki przechodził nawet po SKASOWANIU logiki
chłodzenia (apteczka leżała poza zasięgiem rdzenia) — test bez deliberate-break check jest wart tyle,
co jego brak.

## 5-0cf. ZMIANY update23 (UI portów + oprawa graficzna)
- **STACJA / REPAIR przepisana**: lewa kolumna = STAN STATKU (pasek kadłuba, He2, rakiety, CC,
  lista uszkodzonych modułów, kondycja KAŻDEGO załoganta) — bez tego gracz kupował naprawę
  nie wiedząc ile jej trzeba. Prawa = usługi z WYBOREM ILOŚCI (+1 / +5 / ALL, każdy przycisk
  z ceną). Klinika przy zdrowej załodze mówi "nie ma kogo leczyć" zamiast "CANNOT AFFORD".
- **STACJA / CREW przepisana**: karta rekruta ma WSZYSTKIE skille (piny), kolor korporacji,
  jej REALNY perk opisany słowami (`CORP_PERK` w ui.js — Terra=cyborg itd.), licznik miejsc
  `crew aboard: X/8` i przycisk mówiący czemu nie można kupić ("NEED 20 MORE CC" / "NO BUNK FREE").
- **PUŁAPKI CSS naprawione**: `.shop-card-price::before { content:'⬡' }` zostawiał sierocy znaczek
  przy każdej cenie (waluta to teraz CC) — usunięte. `.station-content` (grid) rozciągał karty do
  najwyższego wiersza → `align-items:start`.
- **Port ma twarz**: `station-sigil` (pierścień dokujący w kolorze typu portu), podtytuł co dany
  port oferuje, akcent `--port-accent`. Typy: military/science/general/outpost.
- **MINIATURY STATKÓW**: `Renderer.drawShipThumb(ctx, layoutKey, x,y,w,h, {rooms})` rysuje
  PRAWDZIWY rzut pokoi (kolory jak w pasku energii, puste wnęki przerywaną linią). Używane
  w hangarze i stoczni. `_entryRooms(entry)` w basescreen.js uwzględnia `extraModules`, więc
  miniatura pokazuje statek JAKI JEST, nie fabryczny.
- **FEEDBACK WALKI**: `Particles.muzzleFlash(x,y,dir,color)` (stożek — `burst()` przyjmuje teraz
  `angleMin/angleMax`), `Particles.damageSmoke(x,y)`. Trafienie: `Particles.floatText` z liczbą
  obrażeń + `room._hitFlash = 1` (wygasza się w `Ship.update`, rysowane w `Ship.draw`).
  Rozbite moduły dymią proporcjonalnie do `damagedLevels`.
- **PRZEJŚCIA**: `_beginFade()` / `_drawFade()` w game.js — krótkie (0.28 s) zaciemnienie przy
  KAŻDEJ zmianie ekranu. Czysto kosmetyczne: stan zmienia się PRZED animacją, nic nie może
  utknąć za kurtyną.
- **PUŁAPKA (druga ofiara tego samego błędu!)**: helper rysujący, który ustawia `ctx.textAlign`,
  MUSI robić `ctx.save()/restore()` — inaczej następny `fillText` woła się wycentrowany i ląduje
  poza swoją kartą. Dotknęło `_btn()` (update21) i `drawShipThumb()` (update23).
  Test sekcji 24 to wykrywa — ale UWAGA: Proxy-ctx z harnessu ma save/restore jako no-op,
  więc test buduje własny ctx MODELUJĄCY stos stanu. Inaczej testowałby atrapę.

## 5-0cg. ZMIANY update22
- **STATKI**: `scout` STRACIŁ moduł osłon — ma teraz `r_hold` typu `empty` (pierwszy realny wybór
  gracza: co tam wstawić). Nowy kupny `hauler` ("Freighter Mule", 240 CC): 2 pokłady, **8 pokoi**
  (3 puste), reaktor 8. Geometria jak scout (szyb 114, kolumny 20|100 · 128|208 · 208|288 · 288|368).
- **SPRZEDAŻ STATKU**: `Base.sellShip(i)` — 30% ceny (`SHIP_RESALE`). NIGDY ostatniego kadłuba.
  Działa ze sprzedanego statku wracają na regał (uwaga: trzeba MATERIALIZOWAĆ wpis — fabrycznie
  nowy ma `data:null`, a mimo to ma fabryczne działa; czytanie `entry.data.weapons` je gubiło).
- **ZBROJOWNIA W BAZIE** (`base.armoury` = tablica defKeys + zakładka ARMOURY):
  * `storeWeapon/sellWeapon/weaponValue` (sprzedaż 50% ceny), `installWeapon/uninstallWeapon`,
    `shipWeapons/shipSlotCount` (do UI), `_materialise(entry)` = JEDNO miejsce budujące Ship
    z wpisu hangaru (fabryczny albo z zapisu) — używać go wszędzie!
  * **Zamontowane działa jadą Z KADŁUBEM** (są w jego zapisie); do zbrojowni trafia TYLKO to,
    co wróciło w ładowni (`weaponCargo`) — inaczej byłyby liczone dwa razy.
  * `Base.launch({weapons:[indeksy]})` zabiera wybrane zapasowe działa; `_startContract` montuje
    je w wolne gniazda, resztę wrzuca do ładowni.
- **STACJE**: `newModules` ma teraz też **shields (60%)** i medbay (35%) — bez tego statek startowy
  nie miałby jak zdobyć osłon. Ceny 90+15×sektor / 70+10×sektor.
- **PRZECIWNICY MOCNIEJSI**: hull +2..+5. Wolna wnęka raidera dostaje JEDEN los:
  `shields` / `cloak` / `empty` (elita: 60/40, brak pustych). To musi być JEDEN rzut — przy dwóch
  osobnych ten drugi praktycznie nigdy nie wypadał, bo pierwszy zajmował wnękę.
  AI odpala cloak w `_updateAI` gdy hull ≤66% albo osłony zbite i lecą pociski.
- **UI**: panel skilli otwiera się TYLKO z listy załogi po lewej (`_hoveredCrew` nie patrzy już na
  sprite'y na statku — zasłaniało widok w walce). Koszary pokazują WSZYSTKIE skille na karcie.
- **STACJA — zakładka WEAPONS przepisana**: dwie kolumny (TWÓJ STATEK z ładownią | STOK STACJI),
  identyczne "chipy" statystyk (DMG/CHARGE/POWER/SHOTS/AMMO) dla każdej broni, jawne przyciski
  i ostrzeżenie gdy poziom wnęki < ⚡ działa (najczęstsze nieporozumienie).
  **PUŁAPKA CSS**: `.station-content` to GRID (`auto-fill minmax(200px,1fr)`) — własny kontener
  musi mieć `grid-column:1/-1`, inaczej ląduje w jednej 200-px kolumnie i wszystko się zgniata.

## 5-0ch. ZMIANY update21 (hotfix + nowy typ testów)
- **BUG KRYTYCZNY (zgłoszony): "ENTER BASE tylko dźwięk i nic"** — użytkownik rozpakował paczkę,
  ale `index.html` NIE został nadpisany, więc `js/base.js` i `js/basescreen.js` nigdy się nie
  ładowały. Klik → `Audio.sfx.uiClick()` → `BaseScreen is not defined` → wyjątek i cisza.
  **NAPRAWA TRWAŁA (nie polegamy na tym, że user nadpisze HTML):**
  * `base.js`/`basescreen.js` publikują się na `window` (top-level `const` w klasycznym skrypcie
    NIE trafia na window — bez tego loader nie może wykryć, czy plik się wykonał!),
  * `game.js` ma `LATE_MODULES` + `_ensureModules()` — w `init()` sprawdza brakujące moduły
    i **doładowuje je sam** (`<script data-autoloaded>`), a jak się nie da, ustawia `_fatal`,
  * klik w menu opakowany w try/catch → `_drawFatal()` rysuje czerwony baner z treścią błędu
    zamiast udawać, że nic się nie stało.
  **Dodając nowy plik js: dopisz go do index.html ORAZ do LATE_MODULES, jeśli ma być odporny.**
- **NOWY RODZAJ TESTU: `tests/browser_test.js`** (Playwright + Chromium, headless). Uruchamia
  PRAWDZIWĄ grę w przeglądarce, klika menu/zakładki/LAUNCH, zbiera `pageerror`. To jedyny test,
  który mógł złapać ten bug — harness node'owy ma Proxy-ctx, który połyka wszystko.
  Druga sesja testu SYMULUJE stary index.html (route przepisuje HTML) i sprawdza samonaprawę.
  `node tests/browser_test.js` — jeśli brak playwright, kończy się czysto (exit 0).
  **URUCHAMIAĆ PRZED KAŻDĄ PACZKĄ razem ze smoke_draw.**
- **Sekcja 19 w run_tests.js**: porównuje `<script>` w index.html z zawartością `js/` (każdy plik
  musi być podpięty, każdy tag musi istnieć) + sprawdza kolejność zależności + obecność
  LATE_MODULES w game.js.
- **Kosmetyka ekranu bazy** (znalezione na zrzucie z przeglądarki): `_btn()` nie przywracał
  `ctx.textAlign` (leak 'center') — tytuł drugiej karty w stoczni lądował na pierwszej; teraz
  `ctx.save()/restore()`. Przycisk LAUNCH zakotwiczony do prawej krawędzi panelu (nachodził na
  manifest). Przycisk w stoczni wyższy (podpis nie wchodził na ramkę).

## 5-0ci. ZMIANY update20 (DUŻA: meta-progresja)
- **NOWE PLIKI**: `js/base.js` (model bazy) + `js/basescreen.js` (ekran bazy).
  W index.html ładowane PO station.js, PRZED renderer.js. base.js potrzebuje Save + CrewMember.
- **BAZA DOMOWA** — stan trzymany w zwykłym save'ie pod `_data.base` (jeden rekord localStorage;
  `Save.getRaw()` dodane właśnie po to). CC bazy = `Save.getScrapBank()` (JEDNA pula, nie dublować!).
  * hangar: `ships[] = {key, data}` (data=null → fabrycznie nowy), `shipSlots()` start 2
  * koszary: `barracks[]` = serialised crew, `barracksCap()` start 5
  * magazyn: `warehouse {fuel, missiles}`, `warehouseCap()` start 20 NA LINIĘ
  * ulepszenia: warehouse (+10), barracks (+2), slot (+1); ceny rosną z poziomem
  * sklep bazy: He2 8 CC/szt, rakiety 5 CC/szt, rekrut 45 CC
- **MODEL CHECK-OUT / CHECK-IN (kluczowy!)**: `Base.launch()` USUWA statek, załogę i zapasy z bazy.
  `_finishContract()` → `_dockAtBase()` → `Base.returnFromRun()` wkłada je z powrotem (z limitami,
  nadmiar przepada i jest raportowany). Porażka = `_onLose()` po prostu NIC nie zwraca — dlatego
  strata jest trwała i nie trzeba niczego kasować. **Nie "naprawiać" tego przez usuwanie z bazy
  przy przegranej — byłoby podwójne.**
- **STATKI**: nowy DARMOWY `scout` ("Tugboat Halcyon", 2 piętra, bez medbayu, reaktor 6) —
  geometria skopiowana z enemy_frigate (szyb 114 nie przecina pokoi). `frigate` (Kestrel) jest
  teraz DO KUPIENIA za 320 CC. Katalog w `SHIP_CATALOG` (base.js).
- **KONTRAKTY** (`MISSIONS` w base.js): `patrol` 2 sektory / boss `elite` / bonus 60 CC,
  `mothership` 3 sektory / boss `station` / bonus 150 CC. Run zapisuje `mission` i `finalSector`.
  `SectorMap(sector, seed, lane, finalSector)` — boss ląduje w OSTATNIM sektorze kontraktu.
  `_nextSector()` używa `run.finalSector`. **Elity WYCIĘTE z generatora** (weight 0 + hard remap),
  jedyna elita to boss kontraktu.
- **BOSS**: `BOSS_VARIANTS` w boss.js — `station` (boss_station, hull 40, 3 działa, 150 CC) i
  `elite` (enemy_gunship, hull 26, 2 działa, 90 CC). `BossManager.start(phase,x,y,variant)`,
  `reset(variant)`. `scrapReward` z wariantu.
- **MENU**: "NEW GAME" → **"ENTER BASE"** (`_openBase`), stan gry `'base'`. Po runie ekran outcome
  wraca DO BAZY, nie do menu. `_startNewRun()` został jako alias na `_openBase()`.
- **Drobne z tej partii**: ostrzeżenie o ucieczce wroga znika po jego zniszczeniu
  (`_onVictory` zeruje `enemyEscapeActive` + guard na `destroyed` w rysowaniu);
  CC zielone / He2 czerwone (czerwień jaśnieje przy ≤2); Laser Mk I chargeTime 5→6 i
  `fireChance: 0.10` (NOWE pole w WEAPON_DEFS — `receiveHit` czyta `def.fireChance ?? 0.25`).

## 5-0cj. ZMIANY update19
- **KRYTYCZNE: `W is not defined` w `_drawCombat`** — blok "Enemy escape progress" czytał `W`,
  które jest zadeklarowane w INNYM (zagnieżdżonym) bloku wyżej. Każda klatka, w której wróg
  spoolował FTL, rzucała ReferenceError z całego `_drawCombat` → czarny/zamrożony ekran.
  Błąd siedział tam od dawna (jest w update16) i to NAJPEWNIEJ zgłaszane "zawieszenia gry".
  Złapał go smoke test dopiero gdy dołożono krok rysujący stan ucieczki wroga.
  **Wniosek: przy każdym nowym stanie UI dopisywać krok do smoke_draw.js.**
- **SOS / Distress Beacon** (`_maybeSOS()` w game.js, wyniki w `_resolveEvent`): próba skoku przy
  0 He2 nie blokuje już gry, tylko odpala event z 3-4 opcjami: kup 4 He2 za `25+sektor*15` CC /
  wymień zapasową broń z cargo na 5 He2 / walcz o paliwo (`sosFight` → `_sosFightPending`,
  gwarantowane 4-7 He2 w `_onWin`) / żebrz (ZAWSZE daje 1-2 He2 — to gałąź anty-softlock,
  nie usuwać!). Za drogi zakup → `sosRetry` odpala beacon ponownie zamiast zjeść wybór.
  `_sosFightPending` zerowane przy ucieczce/porażce.
- **BUG: nowy załogant nie mógł korzystać z windy** — w rzeczywistości NIE dochodził do niego
  rozkaz: załoganci stali DOKŁADNIE na środku pokoju, a środek to punkt, w który klika gracz
  (promień trafienia sprite'a 13 px). Klik = ponowne zaznaczenie stojącego tam gościa.
  Teraz `Ship.stationSpot(room)` rozstawia na pozycjach -26/+26/0 od środka (środek zostaje
  klikalny), używane przez `assignStations()` i `addCrew()`. `addCrew` nadaje też `homeRoomId`
  rekrutom (wcześniej null → nigdzie nie wracali).
- **Rozkład energii PRZECHODZI między walkami** — `_startCombat` wołało zawsze
  `_allocateDefaultPower()` i kasowało ustawienia gracza. Teraz tylko gdy
  `!_playerShip.hasPowerPreference()` (świeży statek). Wróg dalej dostaje domyślny rozkład.
  `serialise()` zapisuje `max(power, desiredPower)`, żeby moduł zbity w chwili skoku nie wrócił
  z zapisu na stałe wyłączony.
- **CLOAK — pełna przebudowa zachowania**:
  * aktywny cloak = **100% uniku** (`receiveHit` zwraca dodged ZANIM poleci rzut na evasion,
    plakietka "CLOAKED"); to nie jest wysoki evasion, tylko gwarancja na czas działania,
  * ładowanie/cooldown **NIE tyka** gdy moduł jest bez prądu albo rozbity (`isDisabled()`),
  * trafienie/odcięcie prądu w trakcie działania → pole pada natychmiast i leci PEŁNY cooldown
    (`UI.notify` tylko dla gracza — `sys.shipIsPlayer` ustawiane w pętli synchronizacji załogi).
- **Ikona ostrzeżenia o ucieczce wroga** — do paska postępu doszedł pulsujący trójkąt `!` nad
  kadłubem wroga z licznikiem `FTL SPOOLING — Xs`.

## 5-0ck. ZMIANY update18
- **WALUTA/PALIWO — tylko etykiety!** złom → **CC** (Corporation Credits), fuel → **He2**.
  Pola w SAVE nadal nazywają się `scrap` i `fuel` (kompatybilność) — NIE zmieniać.
  `Utils.scrapStr/fuelStr/CURRENCY/FUEL_LABEL` = jedyne miejsce definicji. Symbol ⬡ usunięty
  z tekstów (został tylko jako ikona stacji na mapie).
- **BUG: moduł z cyborgiem był "wyłączony"** → `ShipSystem.isDisabled()` patrzyło na SUROWE `power`,
  więc moduł z Terrą przy 0 przydzielonej mocy był martwy (medbay nie leczył). Teraz liczy się
  `effectivePower()`. Cyborg wchodzi do modułu → moduł DZIAŁA sam z siebie; wychodzi → gaśnie.
- **BUG: "widmowa" moc / nie dało się włączyć medbayu** → JEDNO ŹRÓDŁO PRAWDY:
  `ShipSystem.reactorDraw(p)` (cyborg zwalnia 1 jednostkę tylko gdy `p >= workingLevels`).
  Używają go `Reactor.distribute()`, `Reactor.setPower()` **oraz pętla przepływu mocy w
  `Ship.update()`** — ta ostatnia wcześniej odejmowała surowy przydział, więc jednostka zwolniona
  przez cyborga nigdy realnie nie istniała i ostatnie moduły w `this.systems` (zwykle medbay)
  po cichu głodowały. Niezmiennik: `Σ reactorDraw() <= reactor.totalPower`.
  **Jeśli dotykasz mocy — te trzy miejsca muszą używać reactorDraw, inaczej wraca bug.**
- **BUG: nie dało się naprawić dziur ani modułów** — trzy przyczyny naraz:
  * `_crewUnderCursor` promień 20→**13 px** (załogant stojący na środku modułu zjadał każdy klik
    w ten moduł — zamiast rozkazu robiło się ponowne zaznaczenie);
  * ranni leżący w pokoju liczyli się do limitu 3 → pokój "pełny", rozkaz odrzucany. Limit liczy
    teraz tylko `c.alive`, a `_crewUnderCursor` pomija leżących (nie przyjmują rozkazów);
  * `_updateBodies` kazało załogantowi porwać rannego zaraz po wejściu do pokoju i odejść.
    Teraz zbieranie ciał ustępuje: (a) własnemu zadaniu REPAIR/BREACH/FIRE, (b) pokojowi w którym
    pali się / jest dziura / jest zbity moduł (`roomBusy`).
  * Dodatkowo klik w uszkodzony/przedziurawiony pokój nadaje JAWNE zadanie (BREACH/REPAIR).
- **NOWE: ratowanie rannych** — `_updateBodies` miało tylko podnoszenie ciała z TEGO SAMEGO pokoju,
  więc ranny w innym module leżał w nieskończoność (zgłoszony wrogi pilot ignorujący strzelca).
  Teraz „rescue dispatch": najbliższy wolny załogant (`_rescueId`) idzie po rannego.
  **FIELD AID**: gdy nie ma sprawnego medbayu (wrogie fregaty NIE MAJĄ medbayu w ogóle!),
  załogant opatruje rannego na miejscu 2.2 HP/s do progu 30% → wstaje.
- **NOWE: skok na mapie kosztuje 1 He2** (`_travelTo`; wybór pasa startowego w S1 dalej darmowy).
  Brak He2 = skok zablokowany z komunikatem. Żeby nie dało się utknąć: 50% szans na +1-2 He2
  po wygranej walce (`_onWin`).
- **CLOAK przeniesiony na pasek energii (jak w FTL)**: ikona modułu = przycisk aktywacji,
  pierścień wokół ikony = czas trwania / cooldown, sekundy pod ikoną. Klik ikony cloakingu daje
  `sysActivateIndex` (a NIE `sysToggleIndex` — moc ustawia się pinami). Górny przycisk usunięty,
  `_cloakRect()` skasowany, klawisz **C** działa dalej (`_activateCloak()` = wspólna ścieżka).
  Glify: cloaking `◈`, autorepair `⚙`.
- **DRZWI wyrównane** — `Ship.floorDoorY(floor)` (środek pionowego pasa piętra) wyznacza JEDNĄ
  linię dla WSZYSTKICH drzwi piętra: wewnętrznych, windy i śluz. Wcześniej każde drzwi brały
  środek swojego pokoju, więc pokoje różnej wysokości rozjeżdżały hatche (15 pięter w grze było
  krzywych). Rozmiar był już wspólny (w=6, h=34).

## 5a. ZMIANY update17
- **BUG: abordażyści lądowali losowo** → `Ship.addCrew(member, keepPosition=false)`. `_updateParty`
  ustawiał pozycję/roomId na pokój przy wyłamanej śluzie, po czym `addCrew()` PRZESTAWIAŁO ich
  round-robinem po pokojach (`crew.length % rooms.length`). Wywołanie z fazy 'wait'→'inside' używa
  teraz `addCrew(c, true)`. Domyślne zachowanie (rekrutacja, event crew) BEZ zmian.
- **BUG: powrót abordażu → ponowne wyłamywanie tych samych drzwi** → klik w pokój NA WŁASNYM statku
  przy zaznaczonych abordażystach ustawiał im `homeRoomId` na nasz pokój i `moveToOnShip(_playerShip)`,
  choć fizycznie byli na wrogim kadłubie (dalej w `_enemyShip.crew`). `_crewClickResolve` filtruje
  teraz selekcję przez `_playerShip.crew.includes(c)` (`homeSel`) i podpowiada "use RECALL".
- **NOWE: przycisk RECALL** (`_recallRect()`, W/2−65, y72 — 2. rząd pod RETREAT, obok CLOAK).
  `_recallBoarders()` buduje party wroga→gracz z `{recall:true}`. `_makeParty(from,to,crew,opts)`:
  flaga `recall` + `breachNeed` 1.5 s zamiast 4 s. W `_updateParty` gałąź recall NIE ustawia
  `entryDoor.breached` (własna śluza jest tylko cyklowana, nie rozwalana), a po zakończeniu party
  `_updateCombat` i `_recoverBoarders` ustawiają `entryDoor.open = false` (nie wentylujemy statku).
  `_launchBoarders()` bierze tylko załogę Z NASZEGO statku. Etykieta przycisku BOARD pokazuje
  `POD x%` / `RETURN x%` / `BOARDING…` (liczone z breachT/breachNeed — `party.dur` nie istniał,
  stary kod pokazywał NaN%).
- **NOWE: derelikt (wrak z martwą załogą)** — gdy wróg ma 0 żywej załogi, a kadłub > 0 i to nie boss:
  event "Derelict Hulk" (flaga `_derelictOffered`, raz na walkę, reset w `_startCombat` i przy bossie).
  Wybór: **przeszukaj** (`searchDerelict`) — 15% broń, 25% duży złom, 20% ocalały dołącza do załogi,
  25% mały złom, 15% pułapka (10-22 dmg); albo **zniszcz** (`destroyDerelict`) — bonus
  `randInt(25, 40+sektor×8)` do `CombatManager.scrapReward`. Oba kończą wrak (`hull=0, destroyed`).
- **BUG: widmowa moc w reaktorze przy Terra** → `Reactor.distribute()/setPower()` odliczały 1 jednostkę
  dla KAŻDEGO modułu z cyborgiem i `power > 0`. Dla modułu NIE w pełni zasilonego cyborg daje realne
  +1 do wyjścia (`effectivePower`), więc nic nie "zwalnia" — pasek pokazywał pin, którego nie dało się
  wydać. Teraz reclaim TYLKO gdy `p >= s.workingLevels` (moduł pełny — dopiero wtedy cyborg zastępuje
  jednostkę reaktora, bo `effectivePower` i tak jest capowane do workingLevels).

## 5b. ZMIANY update15-16
- **update15**: Door.requestPassage() (nie istniało — zawieszało grę!). Drzwi wewnętrzne
  auto-otwierają się przed załogantem (_tempT 0.4s), śluzy NIE (abordaż wyłamuje przez .breached).
  crew _doorBlocking łapie też śluzy (nie wychodzą w próżnię). Carry-to-medbay bez jittera
  (medPowered guard: nie podnoś rannego już w zasilonym medbayu).
- **update16 — boarding**:
  * _playerCrewAliveCount() liczy załogę WSZĘDZIE (statek + pod _boardingParty.members
    faza≠muster + wrogi kadłub isPlayer). Oba defeat-checki (combat.js linia ~143 tylko hull;
    game.js liczy załogę). Pełny abordaż NIE kończy gry.
  * _recoverBoarders() idempotentne: zeruje party PRZED odzyskaniem (bał "lecą znowu"),
    dedup przez Set. addCrew() ma guard if(this.crew.includes(member)) return (duplikacja).
    _returnBoarder czyści _ordered/carrying/carriedBy.
- **update16 — cyborg (Terra)**: +1 mocy CAP do maxPower (pełny moduł nie przekracza).
  Reactor.distribute()/setPower() odliczają 1 jednostkę na moduł z cyborgiem (p>0 && hasCyborg)
  → wraca do banku. ShipSystem.hasCyborg getter. effectivePower: p=min(workingLevels,p+1).
- **update16 — cloak AKTYWNY**: był pasywny +8%/lvl, teraz zdolność na cooldownie.
  SYSTEM_DEFS.cloaking: cloakDuration 6s, cloakCooldown 22s. ShipSystem: cloakActive/cloakTimer/
  cloakCd, activateCloak(), cloakReady getter, tick w update(). evasion: +0.60 tylko gdy
  cloakActive (cap 0.9). Statek półprzezroczysty tylko gdy cloakActive.
  (UWAGA: przycisk _cloakRect() z update16 USUNIĘTY w update18 — sterowanie jest w pasku energii.)

## 6. TODO — JEDNA AKTUALNA LISTA (przepisana w update65)

> **Ta sekcja była śmietnikiem.** Każda paczka dopisywała swoje TODO na górę i
> nic nie kasowało starych, więc leżały tu obok siebie wpisy sprzeczne
> („NASTĘPNA PACZKA: lista gończa" przy zrobionej liście gończej), ta sama
> nierozwiązana sprawa wypisana cztery razy, i zadania zamknięte trzy paczki
> temu. Historia zmian jest w §5-0*; **tutaj jest tylko to, co jeszcze przed
> nami.** Zasada na przyszłość: pozycja wychodzi stąd, kiedy jest zrobiona —
> nie dostaje przekreślenia.

### 6.1. Zaprojektowane, zatwierdzone, niezrobione

| paczka | dokument | stan |
|---|---|---|
| **GRAFIKA** | `brief-graficzny-ui.md` | patrz 6.4 |

---

## USTALENIA Z 15.09.2026 — ROZMOWA PROJEKTOWA

Cztery bloki uzgodnione z graczem punkt po punkcie. Kolejność niżej jest
kolejnością prac. **Nic z tego nie jest zrobione** — to jest projekt, nie stan.

### U2. Model uszkodzeń ładunku — jedna rodzina reguł

**Zawsze JEDEN przedmiot**, niezależnie od źródła:

| zdarzenie | gdzie | skutek |
|---|---|---|
| ogień | **W MODULE MAGAZYNU** | **jeden przedmiot uszkodzony** |
| dziura w kadłubie | **W MODULE MAGAZYNU** | **jeden przedmiot znika** |
| brak grawitacji | cały statek | **jeden przedmiot uszkodzony** (co jakiś czas) |

**OGIEŃ I DZIURA LICZĄ SIĘ TYLKO W MAGAZYNIE** (doprecyzowanie gracza,
15.09). Pożar w kokpicie nie rusza ładunku. Inaczej ładunek stałby się
dodatkowym pasem HP całego statku, a gracz nie miałby na to żadnego wpływu —
czyli podatek, nie decyzja.

Brak grawitacji jest wyjątkiem i słusznie: nie ma grawitacji nigdzie, więc
rzeczy odrywają się od półek niezależnie od tego, gdzie się pali.

**TO WIĄŻE U2 Z U4.** Dopóki ładownia nie jest pokojem na planie statku, ogień
i dziura **nie mają gdzie w niej wybuchnąć** — dziś `cargo` to siatka bez
pomieszczenia. Czyli **U4 musi iść PRZED U2** (moja pierwotna kolejność była
błędna, poprawiona w U6). Grawitacyjna połowa U2 tego nie wymaga i może iść
razem z U3.

Uszkodzenie i zniknięcie **muszą zostać dwiema różnymi rzeczami** — „mam to
dalej, ale popsute" boli inaczej niż „nie mam tego wcale". Nie zlewać w jedno.

**Połowa jest już w kodzie:** flaga `CargoItem.damaged` (40 % wartości, nie da
się rozpakować, nie liczy się do `countOf`) istnieje od rdzenia `rad`. Ogień
i brak grawitacji używają JEJ, nie nowego stanu. Dopisać trzeba tylko
„znika" — filtr na `grid.items`.

**Odrzucone na stałe: pozycja przy uszkodzeniu przychodzącym** (brzeg/środek,
lewa/prawa). Za drogo w uwadze gracza i łamie zasadę „przychodzące jest
proste". Ryzyko przestrzenne zostaje tam, gdzie gracz je sam wybiera —
w sąsiedztwie rdzenia i chłodziarki.

### U3. Grawitacja — pod silnikami, nie jako osobny moduł

**Brak silników = brak grawitacji.** Decyzja gracza i lepsza niż mój pomysł
z osobnym modułem: zero nowych pokoi, zero przerysowywania kadłubów, zero
nowego przycisku, a rozdział mocy do silników już jest napięciem na pasku.

| | grawitacja WŁ | grawitacja WYŁ |
|---|---|---|
| chodzenie | szybkie | **wolne** |
| noszenie rannych | wolne | **szybkie** (ciało nic nie waży) |
| ogień | normalny | **dusi się sam** |
| ładunek | trzyma się półek | **jeden przedmiot uszkadzany co jakiś czas** |
| ładunek + dziura | — | **wylatuje** |

**Najważniejszy efekt uboczny:** rozbite silniki przestają być czystą karą.
Dziś to tylko mniej uników. Z grawitacją tracisz uniki, ale pożary duszą się
same, a rannych nosi się szybciej. **To nie jest gorszy statek — to jest inny
statek.** Spirala śmierci z FTL przestaje być spiralą.

**Decyzja jest różna za każdym razem**, bo istnieją dwie drogi do tego samego:
- **wypuścić powietrze drzwiami** — za darmo w ładunku, ale wolno, ryzykownie
  dla ludzi, i **czas zależy od tego, gdzie jest ogień** (moduł przy burcie
  schodzi szybko, środek statku długo)
- **ściąć grawitację** — natychmiast i wszędzie tak samo, ale **płacisz
  ładunkiem**, a ile boli, zależy od tego, co wieziesz

**Odrzucone:**
- ~~zbijanie grawitacji wrogowi jako taktyka przed abordażem~~ — **gracz miał
  rację, ja nie**: nasi ludzie stoją na jego pokładzie, więc zwalnia obie
  strony jednakowo. Nic to nie daje
- ~~grawitacja jako osobny moduł z własnym prądem~~ — silniki lepsze

### U4. Magazyn jako moduł: poziom = półka

**To nie jest nowy wzorzec — to wzorzec brygu** (`maxLevel: 3`, „levels are
CELLS, one prisoner each"), który już działa i który gracz już zna.

Kolumny to **belka kadłuba** — fizyczne, nie do dokupienia. Wiersze to
**półki** — poziom modułu. Liczby wychodzą z tego, co już jest:

| kadłub | ładownia dziś | kolumny | maxLevel = półki |
|---|---|---|---|
| Bastet | 5×3 | 5 | **3** |
| Horus | 6×4 | 6 | **4** |
| Hapi | 7×5 | 7 | **5** |

Statek startuje z mniejszą liczbą półek niż max → **nowa ścieżka ulepszeń
konkurująca o te same CC co osłony**, i **widoczna**: kupujesz poziom, w
ładowni pojawia się wiersz.

**Dwa warunki, bez których tego nie zaczynać:**
1. **`layout.cargoRows` przestaje być prawdą.** W chwili gdy wiersze wynikają
   z poziomu modułu, muszą wynikać TYLKO z niego. Zostaje `cargoCols` +
   `maxLevel`, liczbę wierszy liczy JEDNA funkcja. Inaczej to update35 jeszcze
   raz i zapis gry z siatką, której nie da się wczytać
2. **Magazyn NIE bierze prądu.** Półka to półka. Gdyby brał, „reaktor oberwał →
   tracisz ładownię" byłoby nieszczęściem, nie decyzją. Pokój bierny: bierze
   udział w pożarze i rozszczelnieniu, nie w rozdziale mocy

### U5. Wycofane po analizie — NIE robić

- ~~`hazardTick()` przy wyjściu z ładowni~~ — **mój pomysł, wycofany przeze
  mnie.** Karałby gracza **za zajrzenie** do własnej ładowni, czyli uczyłby go
  jej nie otwierać. Moja diagnoza „sąsiedztwo jest martwe" też była przesadzona:
  jest słabe tam, gdzie ładownia jest duża (Hapi 7×5 = 35 komórek), a na Bastecie
  (5×3 = 15) odizolowanie rdzenia często jest fizycznie niemożliwe, więc reguła
  żyje. Patrząc z tej strony to nie bug, tylko **ukryta nagroda za większą
  ładownię**.

  **U3 rozwiązuje to lepiej i za darmo:** skoro brak grawitacji rusza ładunek,
  staranne poukładanie trzyma się tylko tak długo, jak grawitacja.
- ~~własny rozmiar skrzyni w `WEAPON_DEFS`~~ — drugi rejestr obok ceny.
  Jeśli wybór działa okaże się bez ciężaru, **rozsuwać CENY dział**, nie
  dodawać rozmiarów: cena jest dźwignią, skrzynie za nią idą.

### U6. Kolejność prac

**PRZEPISANA 17.09**, uzupełniona o **73a** — patrz „USTALENIA Z 17.09.2026"
wyżej i pomiar kanału niżej. Magazyn jako moduł i palenie ładunku WYPADŁY;
kafelki weszły przed grafikę, bo art kit jest cięty pod te liczby.

| # | paczka | stan |
|---|---|---|
| **73** | **KAFELKI** — 100×60, kanał w module, ostroga, płyta za modułami | **WYDANA** |
| **73a** | **KANAŁ NA 2 KAFLE + LOADER** grafik z fallbackiem | **WYDANA** |
| **74** | **DROBNE** — ikony gracza, TAB, OBJ, nagrobki, zegar wirusa, plądrowanie 50→30 | **WYDANA** |
| **75** | **BROŃ JAKO SKRZYNIA** — skasowany `weaponCargo`, sklep, próg skrzyń, kafel podłogi, VENT→EJECT | **WYDANA** |
| **76** | **PAUZA** na spację + **pasek znaczników** (choroby, głód, przy którym module stoi) | **WYDANA** |
| **77** | **KARBONIT** — bryg zamienia się w płyty; zegar wirusa staje | **WYDANA** |
| **78** | **U1 — opatrunek ≠ medbay** — dawki, zegar zajętości, medbay leczy do pełna | **WYDANA** |
| **79** | **WALKA W MODULE** — 3 na stronę, podmiana rannego, pary 1v1, abordaż do 3, pająk bez tlenu, bug CPU | **WYDANA** |
| **80** | **CO WIDAĆ** — pełny zestaw ikon statusu, jeden zestaw dla listy i pokładu, jedna linia po 14 px, opatrunki i jedzenie na pasku, pociski i wiązka z działek | **WYDANA** |
| **81** | **JEDZENIE** — automat od najgorszej potrawy, zajęte ręce nie pracują, jeden wybierak posiłku | **WYDANA** |
| **82** | **POZIOMY I POWIETRZE** — medbay co 2 lv, tlen jako jeden bilans, podłoga lewej kolumny | **WYDANA** |
| **83** | **KOT NA ROZKAZ** — rozkaz trzyma; kot nie zajmuje miejsca w module i nie naprawia | **WYDANA** |
| **84** | **U10A — SZKODNIKI DO WENTYLACJI** — szczur i pająk poza załogą, kot w kanale, wrak przeszukiwany | **WYDANA** |
| **85** | **U11 — OGIEŃ I POWIETRZE W KANALE** — kanał ma własne powietrze, dziura opróżnia moduł pierwszy, niedobór kanał pierwszy, kanał jest drogą ognia | **WYDANA** |
| **86** | **U10B — EKONOMIA SZCZURÓW** — 3 poziomy, miot, kable tylko bez jedzenia, jajo pierwsze, głodny dorosły rzadko gryzie | **WYDANA** |
| **86a** | **SZYB WINDY, KIERUNEK, WIDOCZNOŚĆ** — szkodniki zmieniają pokład szybem, szczur nie chodzi tyłem, widać je tylko przy załodze/kocie | **WYDANA** |
| 87 | **U13 — grawitacja** (mechanika) | osobny moduł; ostroga czeka pusta z 73 |
| 88 | **RESTYLING** — paleta, glify korporacji, cały art | dopiero gdy UI przestanie się zmieniać |
| 89 | czytelność karmy — animacja muru | `Commander.preview()` już liczy te liczby |

**GRAFIKA ZJECHAŁA NA KONIEC (decyzja 22.09).** Ikonki statusu, pauza i sklep
na kafelkach zmieniają UI — rysowanie tego wcześniej to rysowanie dwa razy.
Sam **loader** wyszedł z tamtej paczki do 73a, bo wszystko inne go potrzebuje,
i dzięki temu grafiki gracza mogą wchodzić po jednej, od paczki 76.

### Zgłoszenia z gry (22.09) — rozdzielone na paczki

| zgłoszenie | paczka | uwaga |
|---|---|---|
| TAB na mapie przełącza mapę zamiast załogi | 74 | `_updateMap` ma `Tab \|\| KeyM`; TAB ma zawsze cyklizować |
| OBJ nachodzi na SHOW MAP i CARGO | 74 | zjechać dwoma przyciskami |
| nagrobki dla tych, których ciał nie ma | 74 | `_drawMemorial` rysuje krzyż dla KAŻDEGO wpisu; ma tylko dla `buried` |
| zegar wirusa widoczny dla gracza | 74 | ma nie być — gracz nie ma wiedzieć, kiedy się aktywuje |
| zegar plądrowania za długi | 74 | **50 s** w trzech miejscach (`?? 50`, `_wreckSecs`) → **30 s**, podłoga 15. Przy okazji jedna stała zamiast trzech kopii |

### KARBONIT — spec gracza (22.09) — ZROBIONE w update77

Zostawione jako spec, bo to ustalenie gracza, nie stan; szczegóły wykonania
w §5-0. Mechanika brygu zostaje, zmienia się nazwa i **zastosowanie**:

- **1 poziom = 1 miejsce = 1 prąd.** Bez różnicy, czy to załogant, czy skazaniec
- **Max 3.** Dwóch zamrożonych, ucinasz jeden prąd → **jeden się rozmraża, drugi nie**
- **Zegar wirusa STOI podczas zamrożenia i rusza dalej od miejsca, w którym
  stanął** po rozmrożeniu

To jest sedno: **karbonit nie leczy, tylko zatrzymuje czas.** Człowiek wraca
dokładnie tak chory, jak był, więc zamrożenie to nie ratunek, tylko odroczenie
kupione za miejsce, prąd i jego ręce przy robocie. Cela jest jedna, a chętnych
dwóch — nagroda za pirata albo życie swojego człowieka. **Decyzja, nie przycisk.**

### Dlaczego 73a istnieje — pomiar, nie przeczucie

Gracz zapytał, czy kanał 10 px pomieści szczura, pająka i kota. Zmierzone
w prawdziwej przeglądarce, na rozmiarze, w jakim gra rysuje te sprite'y
(`anim.draw(..., 32, 32)`), przez policzenie niepustych pikseli w każdej klatce
każdego trybu:

| | rozmiar na ekranie | w kanale 10 px |
|---|---|---|
| szczur | **22 × 10** | mieści się co do piksela |
| pająk | **23 × 13** | brakuje 3 px |
| **kot** | **14 × 16** (siedzący) | **brakuje 6 px** |

Kot jest najwyższy, **bo siedzi na zadzie** — świadoma decyzja z update45, żeby
jego sylwetki nie dało się pomylić ze szczurem („one of them you want aboard and
the other you do not"). Ta decyzja nie mieści się w jednokaflowym kanale.

**Poprawka nie rusza NICZEGO, co dotyczy załogi:**

```
MODULE_H  60 → 70   (7 kafli)
VENT_H    10 → 20   (2 kafle)
wnętrze   50 → 50   ← bez zmian
```

Linia chodzenia, drzwi, stanowiska, szerokości — wszystko zostaje. Rośnie tylko
kadłub, o 10 px na pokład: Apophis na pięciu pokładach 350 px zamiast 300
(i 428 sprzed update73), więc dalej jest niższa, niż była.

**Dlaczego osobno i dlaczego PRZED grafiką:** dokładnie ten sam argument, który
wepchnął kafelki przed grafikę — *art kit jest cięty pod te liczby*. Kratka
narysowana na 10 px i potem rozciągnięta do 20 to grafika do wyrzucenia.
Osobna paczka, żeby 74 startowała na liczbach, które już się nie ruszą.

**Zasada, która wyszła z tej rozmowy i warto ją mieć na wierzchu:**
*jest różnica między nietłumaczeniem głębi a niepokazywaniem skutku.*
Trzy głębokie systemy mogą być bez zarzutu w kodzie i nieczytelne na ekranie,
a żadna z 4156 asercji tego nie złapie — dokładnie jak ucięty powód w update72a.

---

## USTALENIA Z 17.09.2026 — KAFELKI, WENTYLACJA, SZKODNIKI

Ciąg dalszy rozmowy z 15.09. **U4 (magazyn jako moduł) i połowa U2 WYPADAJĄ**
— patrz U12. Nic z poniższego nie jest zrobione.

### U7. Siatka kafli i nowe proporcje modułu

**Najpierw fakt, o którym łatwo zapomnieć: siatka JUŻ ISTNIEJE od update41.**
`HULL_GRID` trzyma jeden rozmiar modułu na całą grę, kadłuby są wypisane
w `(col, row)`, piksele są **wyliczane**, a szyb windy stoi w przerwie MIĘDZY
kolumnami. Komentarz w kodzie mówi wprost: *„changing the module size is
changing one number here and every hull, every door, every lift stop and every
crew station follows"*. To, co robimy, to **podział istniejącego modułu na
mniejsze kwadraty**, nie budowa siatki od zera.

**Powód zmiany (gracz):** 80 × 72 to praktycznie kwadrat (1,11 : 1). Po dodaniu
wentylacji moduł wyglądałby jeszcze bardziej pionowo, a ma **leżeć, nie stać**.

**Kafel 10 × 10 px. Moduł 10 × 6 kafli = 100 × 60 px.**

| stała | dziś | po | kafli |
|---|---|---|---|
| `MODULE_W` | 80 | **100** | 10 |
| `MODULE_H` | 72 | **60** | 6 (górny rząd to wentylacja) |
| `DECK_GAP` | 8 | **0** | pas wentylacyjny SAM jest przerwą |
| `DECK_PITCH` | 80 | **60** | 6 |
| `SHAFT_W` | 28 | **30** | 3 |
| `ENGINE_W` | 48 | **50** | 5 |
| `PROW_W` | 40 | **40** | 4 |

Proporcja **1,67 : 1** zamiast 1,11 : 1. Apophis (5 pokładów) chudnie z 428 px
do 300 — dziś zajmuje prawie cały ekran w pionie.

**Sprawdzone, że dwa kadłuby mieszczą się w 1280 (kamera nie zoomuje —
`setZoom` nie jest nigdzie wołane, więc rysujemy 1:1):**

| kadłub | kolumn | szerokość | dwa takie | luka |
|---|---|---|---|---|
| Bastet | 3 | 448 | 896 | **384** |
| Horus | 3 | 478 | 956 | **324** |
| **Hapi** | **4** | **548** | **1096** | **184** ← najgorszy przypadek |
| Apophis | 2 | 348 | 696 | 584 |

**Najważniejszy wniosek: przy 100 px ŻADEN kadłub nie musi być
przeprojektowany.** Przy 120 px dwa Hapi zostawiały 12 px przerwy i Hapi
musiałaby zejść z 4 kolumn na 3. Przy 100 px Hapi zostaje jaka jest.

**Wróg przesuwa się bliżej:** `worldX` 850 → ~690. Dziś między statkami leży
402 px pustki; po zmianie zostaje ~144 px przerwy na pociski przy dwóch
Hapich. To jest cena szerszych modułów i jest z czego ją zapłacić.

**Do sprawdzenia NA ZRZUCIE EKRANU przy wdrożeniu** (pomiar tego nie złapie):
- `Door.H = 34` przy wnętrzu 50 px to 68 % wysokości ściany (dziś 47 %).
  Drzwi mogą wyglądać na za wysokie. **`Door.GRAB` zostaje 5** — klikanie
  w drzwi naprawialiśmy w update68 i nie wolno go pogorszyć
- linia chodzenia (`WALK_FRAC`) liczy się teraz po WNĘTRZU (50 px), nie po
  całym module

### U8. Postrzępione kadłuby

Dziś każdy kadłub jest prostokątem i wszystkie wyglądają tak samo. Siatka
`kolumny × pokłady` **dopuszcza dziury**: dolny pokład może mieć kolumny 0-1-2,
a górny tylko 0 i 2. Różnorodność bierze się z tego, **które kratki są zajęte**,
nie z przekraczania szerokości.

Przy 100 px to jest **wybór estetyczny, nie konieczność** — żaden kadłub nie
musi się zmieniać, ale możemy zmienić te, które chcemy.

### U9. Wentylacja jako część modułu

**Górny rząd kafli KAŻDEGO modułu** (10 px nad sufitem), nie osobny pas między
pokładami. Wersja gracza, lepsza od mojej z trzech powodów:

1. **Działa na statku jednopokładowym.** Pas między pokładami nie działał
2. **Nie potrzebuje nowej geometrii** — ma współrzędne swojego modułu
3. I najważniejsze: **graf wentylacji to graf pokojów, który JUŻ ISTNIEJE**

```js
class Room { this.adjacent = cfg.adjacent ?? []; }   // ← to jest sieć wentylacji
```

Szczur idzie z wentylacji pokoju A do wentylacji pokoju B, jeśli A sąsiaduje
z B. **Zero nowego szukania drogi.** To była największa pozycja kosztowa całego
pomysłu i po prostu zniknęła.

**Zawartość (fabularnie i mechanicznie):** rury tlenowe i kable energetyczne.
Stąd bierze się cena wyłączania wentylacji (U11) i to, co gryzą szczury (U10B).

**Dostęp:** wyłącznie szkodniki i kot. Załoga nigdy.

**MUSI BYĆ WIDOCZNA.** Jeśli szkodniki żyją tylko w wentylacji, a wentylacji nie
widać, gracz przestaje wiedzieć, że je ma — to jest łamanie zasady „skutek ma
być zobaczony". Jeden kafel wysokości wystarczy, żeby coś się w nim ruszało.

### U10. Szczury i pająki — DWIE PACZKI, nie jedna

**Podział gatunków (decyzja gracza):**
- **Szczury = plaga skalowalna.** Mnożą się same, tempo zależy od JEDZENIA.
  **Nigdy nie są zagrożeniem bojowym** poza poziomem 3 na głodzie
- **Pająki = pasożyty.** Nie rozmnożą się same — potrzebują żywiciela. Ukąszenie
  → wirus → jajo. Odporne na brak tlenu; zabija je **tylko ogień albo kot**
- **Grawitacja nie działa na jedne ani drugie** (małe, pazurzaste)

#### U10A — PRZEPROWADZKA *(w większości KASOWANIE kodu)*

Szkodniki wyprowadzają się do wentylacji. Kot tam poluje. Jaja pająków pojawiają
się w wentylacji. Wypuszczenie powietrza je dusi. Wszystko widoczne na przekroju.

**To jest odejmowanie, nie dodawanie:** dziś szczur to `CrewMember` z
`isVermin`, który stoi w pokoju i bije się z załogą — przechodzi więc przez
bijatykę, obronę modułu i filtry `isBeast` w kilkunastu miejscach. Wypchnięcie
go do wentylacji **kasuje to wszystko**.

**Pająk czasem wyskakuje z wentylacji i atakuje załoganta. Szczur nigdy.**

**JAJA DALEJ MOŻNA SPRZEDAWAĆ** (decyzja gracza 17.09) — 60 CC w porcie zostaje.
Rozstrzygnięte 29.09: jajo jest w ładowni od razu, w kanale tylko się rysuje.
**ZROBIONE w update84** — zostawione jako spec gracza; wykonanie w §5-0.

#### U10B — EKONOMIA SZCZURÓW *(osobno, na gotowym fundamencie)*

**ZROBIONE w update86** — spec zostawiony jako decyzja gracza; wykonanie i liczby w §5-0.

Trzy poziomy:

| lvl | co robi | jak rośnie |
|---|---|---|
| **1 młody** | tylko żre z ładowni | zjadł → lvl 2 |
| **2 średni** | **rozmnaża się**, 2-5 młodych | zjadł → lvl 3 |
| **3 dorosły** | **gryzie kable**, agresywny NA GŁODZIE | — |

**Reguła, która robi z tego decyzję, a nie obowiązek:**
> **Szczury nie gryzą kabli, dopóki w ładowni jest jedzenie.**

Gracz wybiera: karmić szczury albo tracić moduły. Wybiera inaczej w zależności
od tego, ile ma racji — i to jest sedno.

**Gryzienie kabli zbija moduł o JEDEN poziom naraz**, powoli. Jeden szczur nie
rozwala modułu za jednym razem. HP rośnie z poziomem.

Bez jedzenia szczury głodują, ale **wytrzymują długo**.

**Szczury zjadają jaja pająków** (jak kot). Piękna konsekwencja: gracz z plagą
szczurów ma **mniejszy problem z pająkami**. Dwie zarazy tłumiące się nawzajem —
„wytępić wszystko" przestaje być oczywiste.

**Dlaczego to musi być osobna paczka:** trzy poziomy × HP × głód × tempo
rozmnażania × 2-5 młodych × szybkość gryzienia × próg agresji × zjadanie jaj ×
polowanie kota. To kilkanaście pokręteł wpływających na siebie. W jednej paczce
**nie da się tego wyważyć** — nie będzie wiadomo, która liczba psuje.

### U11. Ogień i powietrze w wentylacji

**ZROBIONE w update85** — z ZMIANĄ gracza z 29.09: przełącznika kanału nie ma,
a kolejność zależy od przyczyny (dziura: moduł pierwszy; niedobór: kanał
pierwszy). Spec niżej zostawiony jako historia decyzji; stan w §5-0.

**Ogień:** pali się moduł → zapala się jego sufit (wentylacja) → **dalej stara
mechanika bez zmian**. Nie przepisujemy rozprzestrzeniania, dokładamy jeden krok
w środku. Najtańsza możliwa wersja.

**Powietrze: ODWROTNIE — najpierw pustoszeje wentylacja, potem moduł.**
Fizycznie słuszne (cienki kanał opróżnia się pierwszy) i daje konsekwencję,
której nikt nie planował:

> **Wypuszczenie powietrza zabija szczury SZYBCIEJ, niż gasi ogień.**

Ten sam przełącznik robi dwie różne rzeczy w dwóch różnych momentach, a gracz
wybiera, na którą czeka. Zero nowej treści.

**NIE DODAWAĆ nowej kary HP za wypuszczanie powietrza — ona już istnieje.**
Skafandry mają 8 s (zwykły) do 26 s (Pegasus). Trzymanie statku w próżni dość
długo, żeby wybić szczury, **samo z siebie zjada ludziom powietrze**. Trzeba
tylko tak dobrać czasy, żeby te dwa okna na siebie zachodziły — jedna liczba
zamiast nowego systemu. Przy okazji medbay robi się jeszcze ważniejszy, co jest
zgodne z U1.

**Cena wyłączenia wentylacji (żeby nie była czystą wygraną):** w wentylacji
biegną rury tlenowe, więc **martwa wentylacja = pokoje nie dają się z powrotem
napełnić powietrzem**, dopóki jej nie przywrócisz.

### U12. Co WYPADA z ustaleń z 15.09

- **U4 — magazyn jako moduł: ODWOŁANE** (decyzja gracza 17.09). Dużo roboty,
  mała różnica, a może i gorzej. **Przy okazji znika największe ryzyko całego
  planu — migracja starych zapisów** z siatką innego rozmiaru.
- **U2 — ogień i dziura psujące ładunek: ODWOŁANE w konsekwencji.** Sam
  ustaliłeś, że liczą się TYLKO w module magazynu; bez modułu nie ma gdzie.
  Alternatywa („ogień gdziekolwiek psuje ładunek") to dokładnie ten podatek,
  który odrzuciłeś.
- **Zostaje sama grawitacja jako to, co rusza ładunkiem** — działa na całym
  statku i nie potrzebuje żadnego pokoju.

### U13. Grawitacja — OSOBNY moduł, nie przy silnikach

**Zmiana wobec 15.09, argument gracza:** moduł dający uniki **i** grawitację
byłby oczywistym celem numer jeden w każdej walce — *„wszyscy by tam strzelali"*.
Poza tym wszystko inne w tej grze jest pokojem, który można ostrzelać, więc
grawitacja schowana w silnikach łamałaby spójność.

**Nowy moduł wchodzi do układów W PACZCE Z KAFELKAMI**, bo wtedy i tak
przepisujemy wszystkie kadłuby. Zrobienie tego później to drugi raz ta sama
robota.

**Gdzie go wstawić:** gracz wybrał **dodatkowy pusty moduł na wyższym pokładzie**
(a nie na niższym) — przy okazji rodzi to postrzępiony obrys z U8 i pierwszy
kadłub, który nie jest prostokątem.

### U14. Poprawiona kolejność prac — SKASOWANA

**Tu stała druga tabela kolejności prac, z 15.09.** Do update75 leżała obok tej
z §6 „U6. Kolejność prac" i **mówiła co innego**: u niej 74 to GRAFIKA, a 75 to
opatrunek; u tamtej 74 to drobne zgłoszenia, a 75 broń jako skrzynia. Dwie listy
tego samego, rozjechane o dwie paczki — dokładnie ten błąd, który ta paczka
skasowała w kodzie, tylko zapisany w dokumentacji.

**Jedna kolejność prac żyje w §6.** Ustalenia projektowe z 15.09 (U1–U13) zostają
wyżej, bo to jest PROJEKT; ich kolejność nie.

*(update76: kasowanie w update75 zdjęło nagłówek tabeli i zostawiło jej WIERSZE,
które dalej leżały niżej i dalej mówiły co innego niż §6 — czyli połowiczne
kasowanie zostawiło dokładnie ten problem, który miało usunąć. Teraz nie ma
całej tabeli.)*


---

**RELIGIE ODWOŁANE (decyzja gracza, 2026-09-11).** *„nie jest takie istotne
i duzo nie zmienia"* — wierzenia załogi wypadają z planu w całości: święta, dni
odpoczynku, reguły postu, bagaż wyznaniowy. **Jedzenie zostaje** i zostaje takie,
jakie jest dziś: cztery racje, głód, FEED jako rozkaz, kot odmawiający zieleniny.
Flaga `meat` w `willEat` ma żywego czytelnika (kot), więc nie zostaje po tym
martwe pole. `VENT` = −3 karmy zostaje jedną liczbą dla wszystkich — to był
jedyny dług, który religie miały spłacić. `projekt-religie.md` zostaje
w projekcie jako odrzucony, nie jako kolejka.

### 6.2. Długi z ostatnich paczek

- ~~Uciekinier nie chodzi po korytarzu~~ — **ZROBIONE w update72.** Okazało się
  tańsze, niż wyglądało: `isPrisoner` potrzebował **trzech** filtrów, nie
  kilkunastu — kto jest w bijatyce, kto bierze robotę i kto liczy się jako
  obrońca.
- **Wirusa pająków nie leczy nic na statku** (update68, celowo) — placówka
  badawcza jest jedynym lekiem, a od update69 zegar chodzi też w walce. Jeśli to
  okaże się za twarde, tu jest miejsce na drogi lek w ładowni.
- **Ikona `room_default`** jest jedyną, której nie ma w arkuszu gracza — tło
  przedziału dalej rysuje się z kodu. Nie boli, ale to ostatnie miejsce, gdzie
  grafika i kod pokazują co innego.

### 6.3. Otwarte bugi i pytania balansowe

- ~~Moduł medyka w hangarze~~ — **ZNALEZIONY I NAPRAWIONY w update68.** Cache
  podglądu statku nie znał danych kadłuba. Szukany od update58; kluczem było
  zdanie gracza „widać dopiero po następnej wyprawie", bo bug wymagał CIEPŁEGO
  cache'u, a każde moje polowanie zaczynało się od zimnego.
- ~~Hull Cannon~~ — **decyzja gracza 2026-09-08: zostaje jak jest.** To ma być
  drogie działo dla kogoś, kto planuje zapas.
- **Liczby do wyważenia na żywo** (każda w jednym miejscu w kodzie):

| co | ile | gdzie |
|---|---|---|
| narzut karmy w portach | +25 % / +10 % | `KARMA_BANDS`, `commander.js` |
| odmowa obsługi | co trzeci port przy karmie ≤10 | `portRefuses`, `commander.js` |
| cena rekruta | 0,85× / 1,25× / 1,6× | `recruitFactor`, `commander.js` |
| poddania się wroga | 0 / 0,25 / 0,5 / 0,75 | `surrenderChance`, `commander.js` |
| cela na stacji | 60 % (podniesione z 30 % do testów) | `station.js` |
| port ma dany rodzaj racji | 55 % na rodzaj | `station.js` |
| najedzenie z racji | 25 / 50 / 80 / 50 | `CARGO_ITEMS`, `cargo.js` |
| zegar ucieczki jeńca | 25 s | `Ship.ESCAPE_SECONDS` |
| zegar plądrowania wraku | 30 s, podłoga 15 s | `Ship.LOOT_SECONDS`, `Ship.LOOT_SECONDS_MIN` |
| nagroda za dowódcę spoza listy | `40 + ranga*12 + sektor*10` | `_commanderBounty`, `game.js` |
| nagroda za ściganego | `80 + poziom*20` | `wantedBounty`, `save.js` |
| sektor z plakatem na mapie | 40 % | `WANTED_ON_MAP`, `map.js` |
| sufit listy gończej | 4 | `WANTED_MAX`, `save.js` |
| pochówek / śluza | +3 / −3 karmy | `Ship.BURIAL_KARMA` / `VENT_KARMA` |
| ciało leży niżej niż żywy | 10 px | `CrewMember.BODY_DROP` |
| paliwo po wygranej przy pustych zbiornikach | 1 cela | `_onWin`, `game.js` |
| zbieg: nagroda / poziomy | ×1,5 / +2 | `ESCAPE_BOUNTY_RAISE`, `ESCAPE_LEVEL_GAIN`, `save.js` |
| posiłek jeńca | 1 na skok | `feedPrisoners`, `ship.js` |
| przemiana po ukąszeniu | 300 s w locie | `VIRUS_SECONDS`, `crew.js` |
| wyklucie jaja | 300 s w locie | `EGG_SECONDS`, `crew.js` |
| cena jaja w porcie | 60 CC | `CARGO_ITEMS.spider_egg`, `cargo.js` |
| luz na klikanie drzwi | 5 px przy skrzydle 6×34 | `Door.GRAB`, `ship.js` |
| rabat pirata | 30 % / 45 % przy karmie ≤10 | `pirateDiscount`, `commander.js` |
| próg czarnego rynku | pas narzutu portowego (≤35) | `pirateWillDeal`, `commander.js` |
| praca a głód | 1,20 / 1,00 / 0,75 / 0,50 | `HUNGER.EFFORT`, `crew.js` |
| próg „najedzony" | 80 | `HUNGER.FED`, `crew.js` |
| cele dodatkowe: ile na kontrakt | 2 | `rollRunGoals`, `save.js` |
| ile trzeba i ile płacą | `4+3×sektory` … `25+15×sektory` | `RUN_GOAL_DEFS`, `save.js` |
| Relief Run | 2 sektory, 20 CC, +karma, chip | `MISSIONS.relief`, `base.js` |
| No Questions Asked | 2 sektory, 160 CC, −karma | `MISSIONS.runners`, `base.js` |
| progi obu kontraktów | kolumna ściany ≥4 / ≤2 | `missionRefusal`, `base.js` |
| szansa na więźniów u wroga | 45 % (i tylko przy wolnej wnęce) | `CAPTIVE_CHANCE`, `game.js` |
| karma za uratowanego | `RESCUE_AT_COST` (+10) każdy | `_finishDocking`, `game.js` |
| czas na złapanie uciekiniera | `Door.HACK_TIME` (2,5 s) na właz | `ship.js` |
| szerokość menu przy człowieku | 50 px, 12 px pod nogami | `BODY_MENU_W`, `renderer.js` |
| cele dodatkowe płacą więcej niż kontrakt | 110–140 CC vs 60 CC bonusu Patrolu | `RUN_GOAL_DEFS`, `save.js` |
| zegar plądrowania | **30 s**, podłoga 15 | `Ship.LOOT_SECONDS`, `ship.js` |
| próg skrzyni po cenie działa | ≤50 mała / ≤65 średnia / reszta duża | `cargoCrateForWeapon`, `cargo.js` |
| rozmiary skrzyń na broń | 2×2 / 3×2 / 3×3 komórki | `gun_crate_s/gun_crate/gun_crate_l`, `cargo.js` |
| cena boksowanego działa | 40 / 55 / 75 CC po skrzyni | `GUN_CRATE_VALUE`, `cargo.js` |

- **Pasek zasobów ma 390 px + 118 px odczytu celi** — sprawdzić, czy na 1280 nie
  robi się ciasno.
- **Siedem księżyców na liście DESTINATIONS** — za mało wygląda ubogo, za dużo
  zamienia zapowiedź w listę zakupów.
- **Jajo w ładowni przez całą bazę** — zajmuje celę i tyka. Jeżeli okaże się, że
  gracz i tak zawsze zdąży je sprzedać, zegar wyklucia jest do skrócenia.

- **Czarny rynek (update70) do wyważenia na żywo.** Trzy rzeczy do obejrzenia:
  czy rabat 30 % nie czyni złej karmy po prostu opłacalną; czy rezygnacja
  z nagrody naprawdę boli, skoro ścigany zostaje na tablicy; i czy
  ACCEPT AND STRIKE nie jest zawsze najlepszym wyjściem — −5 karmy przy karmie,
  która i tak jest na dnie, kosztuje mniej niż powinno. Jeżeli tak, pierwsza
  poprawka to **wyższa cena zdrady u samego dna**, nie słabsza zasadzka.

### 6.4. Grafika — to nie są tylko obrazki

**W grze nie ma ANI JEDNEGO pliku graficznego.** Wszystko rysuje `assets.js`
proceduralnie. Więc paczka graficzna to najpierw **loader z fallbackiem** —
brakujący plik musi wracać do generowanego sprite'a, a nie wywalać gry — i
dopiero potem kafle 48×48 i ikony modułów. Paleta (czarny/biały/szary) i cała
reszta w `brief-graficzny-ui.md`.

---
