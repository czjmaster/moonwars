# MOON WARS — prompt startowy do nowego czatu

Skopiuj wszystko poniżej linii i wklej jako **pierwszą wiadomość** w nowym czacie.
Do tej samej wiadomości **załącz zip z całym folderem gry** (`MoonWars/` razem
z `HANDOFF.md`, `index.html`, `js/`, `tests/`).

**Jak zrobić ten zip** — w konsoli, w folderze o poziom wyżej niż gra:

```
cd ~
zip -r moonwars-full.zip MoonWars -x "MoonWars/.git/*" "MoonWars/node_modules/*"
```

Na Windowsie (PowerShell):

```
Compress-Archive -Path ~\MoonWars -DestinationPath ~\moonwars-full.zip -Force
```

Bez tego zipa nowy czat **nie ma dostępu do kodu** — każda sesja startuje na
pustej maszynie.

---

Cześć. Kontynuujemy budowę mojej gry **MOON WARS** — przeglądarkowa gra
inspirowana FTL: zarządzasz statkiem i załogą. Załączam zip z całym projektem.

## Zacznij od tego

1. Rozpakuj zip do katalogu roboczego i **przeczytaj `HANDOFF.md` w całości**
   przed napisaniem choćby jednej linii kodu. To ~2000-linijkowy żywy dokument i
   jedyne źródło prawdy: §1 workflow, §2 architektura, §3 mechaniki, §4 testy,
   §5 pułapki, §5-0 changelog (najnowszy na górze), §6 TODO.
2. Odpal trzy zestawy testów, żeby potwierdzić, że masz czysty punkt startowy:
   ```
   node tests/run_tests.js      → 1878 passed, 0 failed
   node tests/smoke_draw.js     → 32 draw steps ok
   node tests/browser_test.js   → 45 passed, 0 failed
   ```
   `browser_test.js` używa Playwright + Chromium.
3. Jeśli w repo nie ma `.git`, zrób `git init` + pierwszy commit — potrzebne do
   weryfikacji paczki na czystym checkoucie (patrz niżej).

Ostatnia wydana paczka to **update42**. Następna, którą zrobisz, to
**update43**.

## Jak ze mną pracować

- **Pisz po polsku.** Jestem początkujący w gicie — jak coś mam zrobić w
  konsoli, podaj gotowe komendy krok po kroku.
- Wysyłam paczkami: kilka bugów i/lub kilka nowych funkcji naraz. Zrób
  wszystkie, potem jedna paczka.
- **Nie publikuj artefaktów.** Wszystko dostarczaj jako **plik** (zip / html).

## Kontrakt roboczy — obowiązkowy dla KAŻDEGO update'u

1. **Zaimplementuj** wszystko z mojej listy.
2. **Napisz testy** do każdej zmiany, w `tests/run_tests.js` (nowe sekcje
   numerowane dalej — ostatnia to 135).
3. **Weryfikacja przez celowe łamanie kodu.** Zasada z HANDOFF-a: *„test, który
   nie failuje na zepsutej wersji, jest bezwartościowy"*. Napisz skrypt
   (`/tmp/breaksN.py`), który po kolei cofa każdą poprawkę i sprawdza, że
   testy naprawdę padają. **Każde złamanie musi zostać złapane.** Jeśli któreś
   przechodzi — test jest za słaby, popraw test, nie kod.
   Typowe pułapki, na które już się nadziałem w poprzednich sesjach:
   - test woła funkcję **bezpośrednio** zamiast przez prawdziwą ścieżkę
     (wyłączenie jedynego miejsca wywołania jest wtedy niewidoczne);
   - dwie gwardie **maskują się nawzajem** — złam jedną, druga i tak blokuje;
   - warunki brzegowe testowane „już w środku" zamiast dokładnie na granicy;
   - losowość — 35% szansy potrafi przejść fartem; testuj na 40 próbkach albo
     podmień `Math.random` na czas testu.
4. **Wszystkie trzy zestawy zielone.**
5. **Weryfikacja paczki na czystym checkoucie.** Sens: udowodnić, że zip
   naprawdę zawiera wszystko, co się zmieniło, i że po rozpakowaniu u mnie
   gra będzie identyczna jak u ciebie.
   ```
   git archive HEAD | tar -x -C ../verify   # stan sprzed twoich zmian
   unzip -o ../moonwars-updateN.zip -d ../verify
   diff -rq --exclude=.git ../verify .      # MUSI być pusto
   cd ../verify && node tests/run_tests.js && node tests/smoke_draw.js && node tests/browser_test.js
   ```
   (Wymaga, żeby przed zmianami istniał commit z czystym stanem — patrz punkt 3
   sekcji „Zacznij od tego".)
6. **Zaktualizuj `HANDOFF.md`**: nowa sekcja `## 5-0. ZMIANY updateN
   (NAJNOWSZE — …)` na górze changelogu, a wszystkie stare przenumeruj o jedną
   literę w dół (`5-0` → `5-0a`, `5-0a` → `5-0b`, …). Zaktualizuj też §6 TODO.
7. **Spakuj TYLKO zmienione pliki** do `moonwars-updateN.zip` (ze ścieżkami
   `js/…`, `tests/…`), żeby dało się rozpakować na wierzch mojego folderu.
8. **Dostarcz zip** przez SendUserFile + krótkie podsumowanie po polsku:
   co było zepsute, **dlaczego** i co teraz robi.

## Architektura — czego się nie da zgadnąć z kodu

- **Brak modułów ES.** Klasyczne `<script>` w `index.html`; kolejność ładowania
  = kolejność zależności:
  `utils, input, audio, assets, particles, animation, camera, save, crew,
  systems, weapons, oxygen, fire, breach, elevator, cargo, ship, combat, boss,
  map, station, base, basescreen, lootscreen, wreck, renderer, ui, game`.
  Top-level `const`/`class` są współdzielone między skryptami. Cokolwiek ma być
  wykrywalne w runtime — przypisz do `window.X`.
- **Canvas2D 1280×720, UI immediate-mode.** Każdy ekran przerysowuje się co
  klatkę i wrzuca strefy klikalne do `_zones` (`{x,y,w,h,act,arg}`), konsumowane
  przez `update(dt)` → `_act(act, arg)` tego ekranu. **Bug potrafi siedzieć w
  ARGUMENCIE przycisku** — test wołający `_act('sellGun', 3)` wprost tego nie
  zobaczy; asertuj na strefie.
- **`tests/harness.js`** ładuje wszystkie `js/*.js` do jednego kontekstu `vm`
  ze stubami DOM/Audio/localStorage/Canvas i **przepisuje w pamięci**
  `return { init };` z `game.js` na `return { init, __test: {...} };`.
  Gdy potrzebujesz nowej funkcji wewnętrznej w testach — dopisz ją do
  `GAME_TEST_EXPORT`. `Game.__test` **nie istnieje w przeglądarce**.
- **Dwie linie pionowe na pokład:** `floorWalkY = room.y + h*0.65` (stopy załogi)
  vs `floorDoorY = room.y + h*0.5` (drzwi, przystanki windy).
  `Ship.OPERATOR_LIFT = 14` — konsola jest tyle nad linią chodzenia.
- **Triada obsady:** `crewInRoom()` (tylko nasza strona), `occupantsOf()`
  (wszyscy obecni), `crewOperating()` (puste, gdy `roomContested()`).
- **Lustra, nie prawda:** `run.fuel` / `run.missiles` są tylko odbiciem
  `ship.cargo.countOf(...)`, synchronizowanym co klatkę przez `_syncFuel()` /
  `_syncAmmo()`. Prawdą jest ładownia.
- **`Utils.randInt(min,max)` jest `[min,max)` — WYŁĄCZNIE.
  `Utils.randIn(min,max)` jest `[min,max]` — WŁĄCZNIE.** Mylenie ich dało w
  przeszłości pięć błędów off-by-one.
- **`HULL_GRID` + `buildHull()`** (update41) — jedyne źródło geometrii kadłuba.
  Moduł **80×72** na każdym statku i stacji, skok pokładu 80, szyb windy 28.
  Layouty deklarują `(col, row)`, piksele liczy `buildHull()`.
  `Ship.engineSlots()` / `prowSlots()` zwracają kotwice kafli grafiki
  (`slice`: solo/top/mid/bot, `flip` dla wrogich kadłubów).
- **`c.inRoom`** (update42) — ustawiane co klatkę przez `Ship.update`
  **przed** `c.update()`. Szyb windy to prawdziwa podłoga nienależąca do żadnego
  modułu; bez tego pola melee, ogień i `bodiesInRoom` działały przez ściany.
- **`c.isPlayer`** to jedyny znacznik strony. `ship.crew` trzyma **wszystkich
  fizycznie na pokładzie**, łącznie z wrogimi abordażystami. Każdy filtr, który
  ma znaczyć „nasi", musi to sprawdzać jawnie.
- **`CrewMember.isBeast`** = pająk albo szczur. To filtr „to nie jest człowiek"
  dla obsady modułów, noszenia ciał, gaszenia pożarów i czyszczenia rostera.
- **Zegary strat (update42):** `Ship.DECAY_SECONDS 40`, `BLEEDOUT_SECONDS 40`,
  `FIELD_AID_HPS 2.2`, `PLAGUE_RATE_ROOM 0.05`, `PLAGUE_RATE_VENT 0.008`,
  `CORPSE_HOLD_SECONDS 6`. Ogień: `FIRE_DEFS.CLOSED_DOOR_FACTOR 0.2`.

## Co jest następne (uzgodnione ze mną)

1. **KAPITAN / BOHATER — pierwszy w kolejce.** Kapitan z perkami i osią
   dobro–zło, „coś na wzór Heroes of Might and Magic". Do tego **PUPIL: kot
   księżycowy**, który rozwiązuje problem szczurów — szczury (update39) są
   celowo zrobione tak, żeby kot miał co robić. Później może więcej zwierząt.
2. **Ekran sortowania łupów po kontrakcie** — uzgodniony dawno, wciąż nie
   zrobiony. Dziś `_dockAtBase()` po cichu chowa co się da i sprzedaje nadmiar;
   ma się otwierać dwusiatkowy `LootScreen.openLoot(półka, ładownia)` ZANIM gra
   wejdzie w stan `'base'`. Do ustalenia: czy z tego ekranu można sprzedawać i
   co przy zamknięciu bez rozładowania.
3. **Pancerne drzwi z poziomami** — moja zapowiedź przy update42. Haczyk już
   jest: `FIRE_DEFS.CLOSED_DOOR_FACTOR`, poziom drzwi ma go skalować w dół.
4. **Grafika.** Mam brief `moonwars-grafika-statkow-v2.html` (9 assetów B1–B9,
   system „LEGO": kafel silnika na pokład, jeden segment szybu na poziom, dziób
   w trzech zestawach solo / top+bot / top+mid+bot, stacje bez silnika i dziobu).
   Wymiary muszą się zgadzać z `HULL_GRID`. Jak zrobię obrazki, wracamy do
   podpinania ich w `assets.js`.

## Do obserwacji po update42 (jeszcze tego nie testowałem)

- Padnięcie: 35% szans zamiast śmierci, potem **40 s** na ratunek — czy nie za
  karzące.
- Zaraza po raz pierwszy może realnie wybuchnąć na całym statku (wentylacja);
  czy odcięcie tlenu jako kwarantanna jest czytelne.
- Ogień przez zamknięte drzwi na 0.12 zamiast 0.60 — czy warto ich używać.
- **Każda wnęka broni wroga jest uzbrojona** — Sobek w sektorze 1 ma teraz dwa
  lasery. To najostrzejsza zmiana trudności; obserwować.
- Sonda zwiadowcza 35 CC (było 55).
- Latarnia ratunkowa odpowiada raz na węzeł — He2 wreszcie może naprawdę
  skończyć bieg.

Zacznij od przeczytania `HANDOFF.md` i odpalenia testów, potem powiedz mi, że
masz czysty punkt startowy — i wtedy podam pierwszą listę zadań.
