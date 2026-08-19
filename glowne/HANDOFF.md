# MOON WARS — HANDOFF (przekazanie kontekstu między czatami)
> Dla asystenta AI: przeczytaj CAŁY ten plik przed pierwszą zmianą w kodzie.
> Ostatnia aktualizacja: 2026-08-19 (po moonwars-update21).

## 1. WORKFLOW (nie zmieniać!)
- Użytkownik (czjmaster) wgrywa **MoonWars.rar** z aktualnym stanem repo. To JEDYNE źródło kodu
  (GitHub nie daje się fetchować). Folder `glowne/` w RAR ignorować — liczy się `MoonWars/js/`.
- RAR-5 rozpakowywać przez libarchive (ctypes), brak unrar/7z w kontenerze.
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
- Statki: SHIP_LAYOUTS w ship.js (scout=darmowy start gracza, frigate=kupny, enemy_frigate/
  gunship/raider, boss_station). Katalog kupna: SHIP_CATALOG w base.js.
  Współrzędne pokoi są PO dodaniu worldX/worldY w konstruktorze.
- Systemy budowane PER POKÓJ (wiele modułów 'weapons' = wiele niezależnych systemów).
  Energia: kliknięcia w pasek używają INDEKSU systemu (setPowerAt), nie typu.

## 3. KLUCZOWE MECHANIKI (stan aktualny — NIE reimplementować!)
- **BAZA (meta-progresja, update20)**: gra kręci się wokół bazy — z niej startuje KONTRAKT.
  `Base.launch()` wyprowadza statek/załogę/zapasy Z bazy, `Base.returnFromRun()` (przez
  `_dockAtBase`) wkłada je z powrotem po ukończeniu. Przegrana = nic nie wraca (nic nie kasujemy!).
  Limity: magazyn 20/linię, koszary 5 bunków, hangar 2 miejsca — do rozbudowy za CC.
  Kontrakty: `patrol` (2 sektory, boss elite) i `mothership` (3 sektory, boss station).
- **Reaktor**: 1 moc/poziom, cena 10+lvl×8, per-hull max (gracz 16, frigate 12, gunship 14, boss 20).
  Gracz startuje lvl 8. Wróg: reaktor lvl = suma maxPower modułów (capped). Kara nebuli: reactor.penalty.
- **Osłony**: poziom modułu 1-3 (piny = lvl×2, max 6), 2 moce/warstwa; +2 piny na upgrade;
  AKTYWNE od startu walki (prechargeShields); pierścień postępu ładowania na bąblu.
- **Broń**: 1 działo = 1 moduł-pokój; poziom modułu wroga = koszt ⚡ działa; ładowanie wymaga
  OPERATORA w module (bez → charge zamarza, karta "NO CREW!"); broń NIEnaładowana na starcie walki.
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
  leczenie TYLKO w zasilonym medbayu; panel skilli na HOVER. Stany: injured(35% zamiast śmierci,
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
  + kontrola stref klikania), **ekran BAZY (wszystkie 4 zakładki, także pusty hangar/koszary)**,
  `_drawCombat` w 6 wariantach (bez zaznaczenia, BOARD aktywny,
  ucieczka wroga — ten krok wykrył krytyczny `W is not defined`,
  party w locie, RECALL aktywny, party wracająca). Wymaga Save.load()+startRun().
- **tests/run_tests.js**: 332 asercje w 20 sekcjach (reaktor+cyborg, abordaż, RECALL, klik przy
  abordażystach, derelikt, cyborg zasilający moduł sam, naprawy, ratowanie rannych, He2 za skok,
  drzwi, winda dla rekruta, trwałość energii, cloak, SOS, **baza: launch/dokowanie**,
  **trwała strata**, **ekonomia bazy i limity**, **kontrakty/boss/brak elit**,
  **spójność index.html z js/**, boot silnika).
  Każda sekcja FAILUJE na kodzie sprzed swojej poprawki — to prawdziwe testy regresji.
- Testy walki: begin() startuje w 'entering' — odczekać do 'active'; pętle muszą wołać też
  p.update(dt)/e.update(dt) (przepływ mocy po naprawie wraca dopiero w ship.update).
  W testach headless załoga NIE chodzi — pozycje ustawiać ręcznie (patrz `forceMuster()`),
  a wrogowi zabierać broń (`enemy.weapons = []`), żeby długa symulacja nie skończyła się porażką.
  Abordażyści w testach: rasa `pegasus` (nie duszą się w próżni podczas lotu).
- **tests/browser_test.js** (update21): prawdziwa przeglądarka (Playwright+Chromium). Serwuje repo
  na localhost, klika ENTER BASE → wszystkie zakładki → LAUNCH, zbiera `pageerror`/console.error.
  Druga sesja podmienia index.html na "stary" (bez tagów base/basescreen) i sprawdza samonaprawę.
  ŁAPIE to, czego harness nie może: brakujące pliki, realne API canvasu, błędy tylko-w-przeglądarce.
  Można też robić zrzuty ekranu (`page.screenshot`) — bardzo pomocne przy layoutach UI.
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

## 5-0. ZMIANY update21 (NAJNOWSZE — hotfix + nowy typ testów)
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

## 5-0a. ZMIANY update20 (DUŻA: meta-progresja)
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

## 5-0b. ZMIANY update19
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

## 5-00. ZMIANY update18
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
