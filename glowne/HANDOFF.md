# MOON WARS — HANDOFF (przekazanie kontekstu między czatami)
> Dla asystenta AI: przeczytaj CAŁY ten plik przed pierwszą zmianą w kodzie.
> Ostatnia aktualizacja: 2026-08-22 (po moonwars-update35).

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
- **BAZA (meta-progresja, update20)**: gra kręci się wokół bazy — z niej startuje KONTRAKT.
  `Base.launch()` wyprowadza statek/załogę/zapasy Z bazy, `Base.returnFromRun()` (przez
  `_dockAtBase`) wkłada je z powrotem po ukończeniu. Przegrana = nic nie wraca (nic nie kasujemy!).
  Limity: magazyn 20/linię, koszary 5 bunków, hangar 2 miejsca — do rozbudowy za CC.
  ZBROJOWNIA: zapasowe działa (tylko z ładowni!) — montaż/demontaż/sprzedaż przed startem.
  Kontrakty: `patrol` (2 sektory, boss elite) i `mothership` (3 sektory, boss station).
- **Reaktor**: 1 moc/poziom, per-hull max (gracz 16, frigate 12, gunship 14, boss 20).
  **Cenę zna WYŁĄCZNIE sprzedawca**: `Station.reactorCost(ship)` → `REACTOR_PRICE` (wykładnicze,
  od update30). `Reactor.upgradeCost()` skasowane w update34 — była to druga, liniowa cena,
  z której rysował się przycisk, podczas gdy kasa liczyła inaczej (patrz §5-0 pkt 11).
  NIE dodawać ceny z powrotem do sprzętu.
  Gracz startuje lvl 8. Wróg: reaktor lvl = suma maxPower modułów (capped). Kara nebuli: reactor.penalty.
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
- **tests/smoke_draw.js**: URUCHAMIAĆ PRZED KAŻDĄ PACZKĄ — łapie błędy renderowania, których testy
  logiki nie widzą. Pokrywa: drawBackground, oba ship.draw, drawMapScreen (pick i lane),
  drawHUD (map/combat/nebula), UI.draw, pasek energii z modułem CLOAK (READY/CLOAKED/RECHARGE/NO PWR
  + kontrola stref klikania), **ekran BAZY (wszystkie 6 zakładek — HANGAR/ARMOURY/CREW/SUPPLY/UPGRADES/MEMORIAL —
  także pusty hangar/koszary, obie listy hangaru w każdej pozycji przewinięcia,
  jedna półka w SUPPLY, gwiazdki i znaczniki zarazy w barakach, wzgórze
  cmentarza pusto/pełno + najechany nagrobek)**,
  `_drawCombat` w 6 wariantach (bez zaznaczenia, BOARD aktywny,
  ucieczka wroga — ten krok wykrył krytyczny `W is not defined`,
  party w locie, RECALL aktywny, party wracająca). Wymaga Save.load()+startRun().
- **tests/run_tests.js**: 693 asercje w 54 sekcjach (reaktor+cyborg, abordaż, RECALL, klik przy
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
- **tests/browser_test.js** (update21): prawdziwa przeglądarka (Playwright+Chromium). Serwuje repo
  na localhost, klika ENTER BASE → wszystkie zakładki → półka → hangar → LAUNCH, zbiera
  `pageerror`/console.error. Sesja 2 podmienia index.html na "stary" (bez tagów base/basescreen)
  i sprawdza samonaprawę. Sesja 3 to abordaż wraku z prawdziwym drag&drop.
  **Sesja 4 (update34): SKLEP NA STACJI** — jedyny test, który go w ogóle widzi, bo sklep to DOM,
  nie canvas: sprawdza że każdy chip statystyk ma własne SVG i że kwotowana cena reaktora
  ZAWSZE wystarcza na zakup (bug z §5-0 pkt 11).
  ŁAPIE to, czego harness nie może: brakujące pliki, realne API canvasu, DOM, błędy tylko-w-przeglądarce.
  Można też robić zrzuty ekranu (`page.screenshot`) — bardzo pomocne przy layoutach UI.
  **Klikanie zakładek po współrzędnych sprawdza teraz, KTÓRA zakładka się otworzyła**
  (`BaseScreen._state().tab`). Wcześniej pętla asertowała tylko „brak błędu", więc gdy doszła
  ARMOURY, test przez wiele update'ów po cichu klikał w złe zakładki i nadal był zielony.
- Po zmianach balansu AKTUALIZOWAĆ stare testy zamiast "naprawiać" kod pod stare oczekiwania.

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
- **Linia CHODZENIA (`floorWalkY`, y+h*0.65) ≠ linia DRZWI (`floorDoorY`, y+h*0.5).**
  Logika ruchu jedzie po pierwszej, rysowanie drzwi/szybu/kabiny po drugiej. Mylenie ich
  to był „pusty szyb niżej niż drzwi" (update34).

## 5-0. ZMIANY update35 (NAJNOWSZE — JEDEN MAGAZYN, klasy broni, cmentarz, 6 bugów załogi)

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

## 5-0a. ZMIANY update34 (WAREHOUSE wchłonięty przez SUPPLY, UI bazy, załoga przy konsolach, 3 realne bugi)

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

## 5-0b. ZMIANY update33 (magazyn bazy jako prawdziwa siatka)

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

## 5-0c. ZMIANY update32 (kolory ładowania, reaktor jako moduł, przebudowa UI bazy)

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

## 5-0d. ZMIANY update31 (jaja we wrakach, sprite'y pająków, grafika broni, nazwy egipskie)

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

## 5-0e. ZMIANY update30 (bilans modułów, drzwi na czas, grafika broni, naprawa w bazie)

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

## 5-0f. ZMIANY update29 (broń tylko w mount albo w skrzyni, kolory korporacji, martwe wraki, hangar)

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

## 5-0g. ZMIANY update28 (dokowanie, wraki po których się chodzi, pająki i wirus)

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

## 5-0h. ZMIANY update27 (łączenie stosów, skrytka na broń, winda po abordażu)

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

## 5-0i. ZMIANY update26 (STOSY: ilość JEST przedmiotem)

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

## 5-0j. ZMIANY update25 (amunicja i broń w ładowni, salwy, więcej wraków)

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

## 5-0k. ZMIANY update24 (ładownia siatkowa + ekran łupu)

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

## 5-0l. ZMIANY update23 (UI portów + oprawa graficzna)
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

## 5-0m. ZMIANY update22
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

## 5-0n. ZMIANY update21 (hotfix + nowy typ testów)
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

## 5-0o. ZMIANY update20 (DUŻA: meta-progresja)
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

## 5-0p. ZMIANY update19
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

## 5-0q. ZMIANY update18
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

## 6. NAJBLIŻSZE TODO (wg użytkownika)
- ~~Scalić magazyny w jeden~~ — ZROBIONE w update35 (jedna `CargoGrid`, PACK HOLD
  i OPEN WAREHOUSE to jeden ekran).
- **EKRAN SORTOWANIA ŁUPÓW PO KONTRAKCIE (uzgodnione, NIE zrobione — pierwszy w kolejce).**
  Użytkownik: „po zakonczonym kontrakcie jak wroci sie do bazy zalaczy sie ekran
  z magazynem bazy i statku aby gracz mogl przesortowac lupy". Dziś `_dockAtBase()`
  po cichu chowa co się da na półkę i sprzedaje nadmiar. Zamiast tego ma się
  otworzyć dwusiatkowy `LootScreen.openLoot(półka, ładownia)` — ten sam mechanizm
  co PACK HOLD i wraki — ZANIM gra wejdzie w stan 'base'. Do ustalenia z użytkownikiem:
  czy z tego ekranu można też sprzedawać (`onSell` już istnieje) i co się dzieje,
  gdy gracz zamknie ekran nie rozładowawszy wszystkiego.
- ~~Magazyn w bazie jako SIATKA~~ — ZROBIONE w update33.
- ~~Scalić półkę z SUPPLY / usunąć zakładkę WAREHOUSE~~ — ZROBIONE w update34
  (półka to trzecia karta w SUPPLY, przycisk OPEN SHELF).
- ~~Pakowanie rzeczy Z PÓŁKI na kontrakt~~ — ZROBIONE w update35: PACK HOLD
  bierze wprost z jedynej półki.
- Do zbalansowania po update35: nowe role broni (ion/flak jako zdejmowacze
  osłon, flak bez dmg kadłuba) i 1 s stuna na pocisk jonowy — dopiero co
  zaczęły działać naprawdę i zmieniają przebieg walki.
- Ekwipunek załoganta: 1 slot (pancerz / karabin abordażowy / zestaw
  naprawczy). Użytkownik: „zrobimy, ale później".
- Zbalansować ładownię w praktyce: tug 5x3 = 15 kratek, a sam regał rakiet to 3 kratki.
  Jest już CARGO RETROFIT za CC, ale jeśli start jest za ciasny — powiększyć scouta do 5x4.
- **Minigra dokowania** — max 3-5 s, jeden mechanizm (znacznik w zielonej strefie), ZAWSZE
  pomijalna (auto-dok za trochę He2), z realną stawką: perfekcyjny dok = brak zużycia He2 /
  zniżka w porcie, spartaczony = drobne uszkodzenie kadłuba. Użytkownik ODRZUCIŁ wariant bojowy
  (dokowanie do wroga) — wymagałby animacji sklejania dwóch statków.
- ~~Wraki, po których się chodzi~~ — ZROBIONE w update28.
- ~~Minigra dokowania~~ — ZROBIONE w update28.
- ~~Pająki i wirus~~ — ZROBIONE w update28.
- Do zbalansowania w praktyce: liczba pająków (`derelictSpiderCount`), 35% szansy na
  zarażenie, 3 walki do śmierci / 3 do wyklucia, 45 CC za kwarantannę.
- **Obcy / pajęczaki (uzgodnione z użytkownikiem, do zrobienia razem z wrakami):**
  małe pająki atakują wręcz; ugryziony członek załogi dostaje ikonę WIRUSA; po kilku walkach
  umiera i zostaje po nim JAJO; jajo po kilku walkach się wykluwa → 1-3 nowe pająki; ugryzienie
  przez nie działa tak samo. Leczenie: stacja badawcza (`science`) usuwa wirusa.
  W `cargo.js` jest już przedmiot `spider_egg` (tag `egg`) jako zaczep pod tę mechanikę.
- Zbalansować ceny bazy w praktyce (statek 320 CC, ulepszenia 120/150/400 CC, bonusy kontraktów
  60/150 CC + połowa CC z runu). Po pierwszych testach użytkownika prawdopodobnie do korekty.
- Rozważyć nagrodę CC za dotrwanie do końca sektora (teraz płaci głównie boss + zapasy).
- Sprawdzić balans He2 w praktyce (start 10, 1/skok, 50% szans na 1-2 po walce, SOS jako
  zabezpieczenie) — jeśli za ciasno, podnieść start albo szansę dropu, NIE zmieniać kosztu
  skoku (użytkownik chciał 1/skok).
- Rozważyć wpisanie SOS także jako losowy event na mapie (teraz odpala się TYLKO przy 0 He2).
- Nowe moduły: sensory, teleporter, artyleria, hangar dronów (SYSTEM_DEFS ma już glyph artylerii).
- Bossowie sektorów 2-3 (wieloetapowi) — obecna stacja to boss "jednofazowy".
- Zgłoszone zawieszenia gry: guardy dodane; jeśli wróci — poprosić o zrzut z konsoli F12.
- Do rozważenia po update17: walka wręcz abordażystów z załogą wroga jest w crew.update, ale nie ma
  dla niej testów — przy kolejnych zmianach w abordażu dopisać sekcję do tests/run_tests.js.
