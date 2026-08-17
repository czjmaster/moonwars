# MOON WARS — HANDOFF (przekazanie kontekstu między czatami)
> Dla asystenta AI: przeczytaj CAŁY ten plik przed pierwszą zmianą w kodzie.
> Ostatnia aktualizacja: 2026-08-17 (po moonwars-update16).

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
- **Cyborg (Terra)**: +1 mocy wędruje z załogantem — działa też przy 0 przydzielonej mocy,
  bez clampa do poziomu modułu; turkusowy pip w pasku. Pegasus: nie oddycha. Aquarius: nie płonie
  przy gaszeniu. Phoenix/inni: 2× XP w specjalizacjach (CORP_DEFS).
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
- **Boarding (FIZYCZNY)**: BOARD → zaznaczeni idą do śluzy gracza → wychodzą → lot 85 px/s →
  wyłamywanie śluzy wroga ~4 s (iskry, łuk postępu) → drzwi trwale otwarte → wejście.
  Próżnia: nie-Pegasus 2.2 HP/s. Abordażyści STEROWALNI (klik pokoju wroga, _ordered wyłącza
  auto-roam AI). Walka w pokojach + sabotaż istnieją w crew.update. Kontra-abordaż po odmowie
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

## 4. TESTY (odtworzyć w nowym kontenerze — kontener resetuje się między sesjami!)
- Harness Node: stuby Utils/Audio/UI/Particles/Save/Assets/Animation + vm.runInThisContext
  z hoistingiem `class/const/let → globalThis`. Pliki ładować w kolejności zależności.
- **smoke_draw.js**: Proxy-ctx + stub DOM/AudioContext; Renderer.init, drawBackground, oba ship.draw,
  drawMapScreen (pick i lane), drawHUD (map/combat/nebula), UI.draw. Wymaga Save.load()+startRun().
  URUCHAMIAĆ PRZED KAŻDĄ PACZKĄ — łapie błędy renderowania, których testy logiki nie widzą.
- Testy walki: begin() startuje w 'entering' — odczekać do 'active'; pętle muszą wołać też
  p.update(dt)/e.update(dt) (przepływ mocy po naprawie wraca dopiero w ship.update).
- Po zmianach balansu AKTUALIZOWAĆ stare testy zamiast "naprawiać" kod pod stare oczekiwania.

## 5. PUŁAPKI (nauczone bólem)
- Skrypty patchujące: die-on-first-assert → część plików zapisana, część nie. Po KAŻDYM patchu
  weryfikować grepem stan na dysku. Łańcuchy `grep && cat > plik` — grep bez trafienia ucina cat!
- RAR zawiera więcej niż PROJECT.md sugeruje — najpierw grep, potem implementacja (boarding,
  lastGunnerId, perki ras JUŻ ISTNIAŁY gdy TODO twierdziło inaczej).
- Save niekompatybilny po zmianach struktur → zawsze pisać "nowy run".
- Serializacja systemów PO INDEKSIE; kupione moduły w extraModules ({type, roomId}) aplikowane
  PRZED odtworzeniem systemów.

## 5b. ZMIANY update15-16 (najnowsze)
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
