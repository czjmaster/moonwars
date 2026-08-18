# MOON WARS — HANDOFF (przekazanie kontekstu między czatami)
> Dla asystenta AI: przeczytaj CAŁY ten plik przed pierwszą zmianą w kodzie.
> Ostatnia aktualizacja: 2026-08-18 (po moonwars-update17).

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
- Canvas 2D 1280×720. Stany gry: menu / map / combat / event / station / outcome.
- Pliki: utils, assets, audio, input, camera, particles, animation, oxygen, fire, breach, elevator,
  systems, weapons, crew, ship, map, save, station, boss, combat, renderer, ui, game.
- Statki: SHIP_LAYOUTS w ship.js (frigate=gracz, enemy_frigate/gunship/raider, boss_station).
  Współrzędne pokoi są PO dodaniu worldX/worldY w konstruktorze.
- Systemy budowane PER POKÓJ (wiele modułów 'weapons' = wiele niezależnych systemów).
  Energia: kliknięcia w pasek używają INDEKSU systemu (setPowerAt), nie typu.

## 3. KLUCZOWE MECHANIKI (stan aktualny — NIE reimplementować!)
- **Reaktor**: 1 moc/poziom, cena 10+lvl×8, per-hull max (gracz 16, frigate 12, gunship 14, boss 20).
  Gracz startuje lvl 8. Wróg: reaktor lvl = suma maxPower modułów (capped). Kara nebuli: reactor.penalty.
- **Osłony**: poziom modułu 1-3 (piny = lvl×2, max 6), 2 moce/warstwa; +2 piny na upgrade;
  AKTYWNE od startu walki (prechargeShields); pierścień postępu ładowania na bąblu.
- **Broń**: 1 działo = 1 moduł-pokój; poziom modułu wroga = koszt ⚡ działa; ładowanie wymaga
  OPERATORA w module (bez → charge zamarza, karta "NO CREW!"); broń NIEnaładowana na starcie walki.
  Moduły broni gracza 2/3 dokupywane (konwersja pustego pokoju, wybór pokoju na blueprintcie).
- **Cyborg (Terra)**: +1 mocy wędruje z załogantem, CAPOWANE do workingLevels modułu (pełny moduł
  nic nie zyskuje); turkusowy pip w pasku. Zwrot jednostki do banku reaktora TYLKO gdy moduł jest
  już w pełni zasilony (update17 — inaczej powstawał niewydawalny "widmowy" pin).
  Pegasus: nie oddycha. Aquarius: nie płonie przy gaszeniu. Phoenix/inni: 2× XP (CORP_DEFS).
- **Drzwi**: binarne (zielone otwarte / czerwone zamknięte), przyciski OPEN/CLOSE ALL (ze śluzami,
  z ostrzeżeniem); załogant czeka aż drzwi się rozsuną (Door._tempT, _doorBlocking).
- **Ogień**: rośnie co 9 s, spread co 12 s przez ściany NIEZALEŻNIE od drzwi, -1 HP kadłuba/6 s.
- **Tlen**: pasywny drain (O2 bez prądu = powolne duszenie), szybki przepływ przez otwarte drzwi,
  DRAIN_VACUUM 0.216. Priorytet auto-alokacji: oxygen→piloting→shields→weapons→engines→medbay.
- **Załoga**: multi-select ramką (press/drag/release), Shift, 2×klik=wszyscy; max 3/moduł;
  leczenie TYLKO w zasilonym medbayu; panel skilli na HOVER. Stany: injured(35% zamiast śmierci,
  także z uduszenia) / dead / decaying / infected. Żywy niesie rannego→medbay, trupa→śluza;
  niepochowane ciało gnije od NASTĘPNEJ walki (markCombatStart) i zaraża; zarażeni wędrują,
  czasem sami wychodzą śluzą. Klinika stacji: 12⬡/pacjent (full heal + leczy zarazę).
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
- **Walka**: pertraktacje przed walką 45% (danina: złom/załogant/walka), kapitulacja ≤30% HP 50%,
  ucieczka wroga ≤45% HP 45% (11 s, pasek, zbicie kokpitu/silników zeruje), retreat gracza 9 s
  spool (przycisk pod zasobami, zeruje się po knock-oucie napędu). AI chroni pilota i OSTATNIEGO
  strzelca (lastGunnerId). Nebula: 55% zasadzka, obie strony -2 mocy, fiolet fog.
- **Boss**: boss_station — pionowa stacja 6 pięter, centralna winda x=150, 3 moduły broni
  z operatorami, hull 40, crew 6, JEDNA walka (BOSS_PHASES ma 1 wpis). Maszyna faz w _updateCombat
  PRZED CombatManager.update. Wznawia fazę po ucieczce; reset() przy nowym runie.
  Wieloetapowi bossowie planowani per-sektor (TODO).
- **Mapa**: 6×3, zawsze 3 starty i 3 wyjścia; PASY (wyjście rzędem R → start rzędem R, Save run.lane);
  sektor 1: gracz wybiera pas (awaitingStartPick, banner); ≥1 stacja/sektor; żadna kolumna pusta;
  zero elit w S1. Widok mapa⇄statek: przycisk + klawisz M.
- **Sklep**: blueprint statku (klik moduł→upgrade, reaktor też; wybór pustego pokoju dla nowych
  modułów); zakładki repair(+klinika)/weapons(cargo, sprzedaż 50%, ⚡ wszędzie)/modules/crew(korporacje).
  Zakładki reactor NIE MA. Nowe moduły (cloaking +8% unik/moc, autorepair) losowo w stocku,
  startują BEZ mocy.
- **UI**: status w 1 linii: EVADE→OXYGEN→bąble (wspólny styl _shieldBubble); notyfikacje dół-środek;
  panel modułów wroga: REAKTOR PIERWSZY z lewej; moduły broni w pasku energii NA KOŃCU obok kart dział.
- **Stabilność**: guardy pętli w animation.update (frameDur>0 + cap 240), utils.wrapAngle (isFinite),
  audio scheduler (cap 64). dt clampowane do 0.05 w _loop. NIE usuwać tych guardów.

## 4. TESTY — **SĄ JUŻ W REPO** (od update17: folder `tests/`, nie trzeba odtwarzać!)
- Uruchamianie (z `C:\MoonWars\`, wymaga Node): `node tests/smoke_draw.js` i `node tests/run_tests.js`.
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
  drawHUD (map/combat/nebula), UI.draw, `_drawCombat` w 5 wariantach (bez zaznaczenia, BOARD aktywny,
  party w locie, RECALL aktywny, party wracająca). Wymaga Save.load()+startRun().
- **tests/run_tests.js**: 43 asercje w 6 sekcjach (reaktor+cyborg, lądowanie abordażu, RECALL,
  klik w swój pokój przy abordażystach, derelikt, boot silnika). Każda sekcja FAILUJE na kodzie
  sprzed update17 — to prawdziwe testy regresji, nie atrapy.
- Testy walki: begin() startuje w 'entering' — odczekać do 'active'; pętle muszą wołać też
  p.update(dt)/e.update(dt) (przepływ mocy po naprawie wraca dopiero w ship.update).
  W testach headless załoga NIE chodzi — pozycje ustawiać ręcznie (patrz `forceMuster()`),
  a wrogowi zabierać broń (`enemy.weapons = []`), żeby długa symulacja nie skończyła się porażką.
  Abordażyści w testach: rasa `pegasus` (nie duszą się w próżni podczas lotu).
- Po zmianach balansu AKTUALIZOWAĆ stare testy zamiast "naprawiać" kod pod stare oczekiwania.

## 5. PUŁAPKI (nauczone bólem)
- Skrypty patchujące: die-on-first-assert → część plików zapisana, część nie. Po KAŻDYM patchu
  weryfikować grepem stan na dysku. Łańcuchy `grep && cat > plik` — grep bez trafienia ucina cat!
- RAR zawiera więcej niż PROJECT.md sugeruje — najpierw grep, potem implementacja (boarding,
  lastGunnerId, perki ras JUŻ ISTNIAŁY gdy TODO twierdziło inaczej).
- Save niekompatybilny po zmianach struktur → zawsze pisać "nowy run".
- Serializacja systemów PO INDEKSIE; kupione moduły w extraModules ({type, roomId}) aplikowane
  PRZED odtworzeniem systemów.

## 5a. ZMIANY update17 (NAJNOWSZE — 3 zgłoszone bugi + nowa mechanika)
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
  cloakActive (cap 0.9). Statek półprzezroczysty tylko gdy cloakActive. Przycisk _cloakRect()
  (W/2-210, y72) + klawisz C w game.js. Rysowanie stanu (READY/CLOAKED Xs/RECHARGE Xs).

## 6. NAJBLIŻSZE TODO (wg użytkownika)
- Nowe moduły: sensory, teleporter, artyleria, hangar dronów (SYSTEM_DEFS ma już glyph artylerii).
- Bossowie sektorów 2-3 (wieloetapowi) — obecna stacja to boss "jednofazowy".
- Zgłoszone zawieszenia gry: guardy dodane; jeśli wróci — poprosić o zrzut z konsoli F12.
- Do rozważenia po update17: walka wręcz abordażystów z załogą wroga jest w crew.update, ale nie ma
  dla niej testów — przy kolejnych zmianach w abordażu dopisać sekcję do tests/run_tests.js.
