# Projekt UI

Stan wdrożenia w `apps/web` na 2026-11-06. Projekt powstał 2026-11-04 (prototyp na danych syntetycznych: [ui-prototype.html](ui-prototype.html), prywatny [artefakt](https://claude.ai/artifact/PbNSGrNRUVXLGGNt1kaVSU)), a 2026-11-05 interfejs uproszczono: zniknął panel szczegółów wartości, ikony „?” z metadanymi, zakładki dnia „Podsumowanie” i „Pochodzenie danych” oraz oznaczenie komórek uzupełnionych z CSV. Prototyp pokazuje więc wcześniejszą wersję. Reguły danych z [kontraktów](../data-contracts.md) mają pierwszeństwo; decyzje użytkownika: [rejestr](../decisions.md).

## Założenia

- Jeden użytkownik, desktop w przeglądarce, ciemny motyw; telefon: podstawowy odczyt, w przyszłości szybkie wpisy jedzenia (zadania: [plan 10](../plan/10-mobile.md)).
- Preferencje widoku (kafelki, kolumny, zakres) docelowo w bazie, wspólne dla desktopu i telefonu (decyzja 2026-11-06, [plan 04](../plan/04-ui-workouts.md#preferencje-widoku-w-bazie)); dziś kolumny i zakres są zapamiętywane w przeglądarce. Zwinięcie lewej nawigacji zostaje lokalne dla urządzenia.
- Nie pokazujemy panelu metadanych wartości (źródła, model, definicja, identyfikatory); pochodzenie i diagnostyka są w „Źródłach danych”, a stan i uwagi w formie, jak dotąd. Nowe metadane w widokach rozstrzygamy osobno, przypadek po przypadku.
- Główna praca to przegląd dnia i porównanie dni. Diagnostyka odczytów jest w „Źródłach danych”, nie w głównych widokach.
- Stan wartości widać w formie, nie tylko w tekście (sekcja [Język wizualny](#język-wizualny)).

## Nawigacja

Lewa nawigacja (zwijana do ikon, stan zapamiętany w przeglądarce): **Dane** — Dzień, Trendy, Tabela dni, Treningi; **Jedzenie** — Dziennik, Produkty i przepisy, Planer; **System** — Źródła danych, Ustawienia. Pozycje przyszłych etapów (Treningi M2, jedzenie M3–M4) są wyszarzonymi placeholderami z opisem zakresu. Na wąskim ekranie dolny pasek: Dzień, Trendy, Dni, Jedzenie, Więcej.

Stopka nawigacji pokazuje czas ostatniego odświeżenia Google (harmonogram w podpowiedzi); kliknięcie uruchamia odświeżenie. Globalny błąd sieci jest stanem synchronizacji, nie uwagą przy każdym dniu.

Pasek górny: tytuł (w widoku Dzień — data), kontrolka daty lub zakresu widoku i „Dodaj” (notatka do dnia; „Posiłek” i „Pomiar wagi” nieaktywne). Adresy w hashu: `#dzien[/RRRR-MM-DD][/zakładka]`, `#zrodla[/zakładka]`, `#jedzenie[/zakładka]`, `#tabela`, `#trendy`; domyślna zakładka i dzisiejsza data nie trafiają do adresu.

## Widoki

### Dzień (ekran startowy)

Wybór dnia strzałkami, polem daty, „Dziś”, z klawiatury ←/→ i `t`. Dla bieżącej doby „w toku · stan na HH:MM” (czas ostatniego udanego odświeżenia), przy zmianie czasu znacznik „doba 23 h / 25 h”. Strefa czasowa nie jest pokazywana poza Ustawieniami. Zakładki: **Przebieg doby** (domyślna), **Dane godzinowe**, Jedzenie (M3), Treningi (M2).

- **Przebieg doby:** karty metryk w grupach Energia, Aktywność, Ciało. Karta ma wartość dnia ze stanem i porównanie ze średnią 7 poprzednich dni („6 z 7 dób”); dla masy i tkanki bez pomiaru — „ostatni pomiar … · data”, bez przenoszenia na dzień. Karty energii i aktywności mają miniwykres godzinowy doby (z okien 10-minutowych), karta „Tętno” — wykres okien. Kliknięcie powiększa wykres. Pod kartami edytowalna „Moja notatka”.
- **Dane godzinowe:** tabela godzin (spalone i aktywne kcal, kroki, dystans, zakres tętna) — dostępny odpowiednik wykresów.
- **Prognoza (doba w toku):** karta spalonych kalorii pokazuje „Prognoza: X kcal” (`prognoza-bez-wysilku-v2`: reszta doby w tempie tej samej godziny z okien ostatnich dób bez znaczących kalorii aktywnych, założenie („bez znaczącego wysiłku”) tylko w podpowiedzi przy „prognoza X kcal” (nagłówek powiększenia, karta, legenda, trendy), nie mniej niż `prognoza-spoczynek-v0`; bez historii v0; [kontrakty](../data-contracts.md#pochodne-prezentacyjne-ui-2026-11-04)); na wykresach godzinowych pozostała część doby jest przerywana, od końca ostatniego okna kalorii. Nie trafia do tabeli, średnich ani eksportu.
- **Powiększenie godzinowe:** przełącznik metryki, opcjonalna linia tętna (prawa oś, bpm). Tytuł podaje wartość dobową producenta (tę samą co karta i tabela), a sumę godzin tylko przy jej braku, z dopiskiem. Dla starszego modelu kalorii i doby bez odczytu — wyjaśnienie braku rozkładu zamiast zer.
- **Tętno doby:** okna 10-minutowe jako pas min–maks. z linią średniej; okna bez pomiaru to przerwy. Oś dopasowana do danych (np. górna linia 175 dla maks. 171, 200 dla 212 z marginesem na słupki).

### Tabela dni

- Zakres: Tydzień, Miesiąc, 3 i 6 miesięcy, Rok, 2 lata, 5 lat, Od początku (pierwszy dzień z danymi widocznych kolumn) albo własne „od – do”; pola i lista są zsynchronizowane, wybór zapamiętany w przeglądarce. Dłuższe zakresy są pobierane porcjami po ≤ 366 dni.
- Menu „Kolumny” w nagłówku (po lewej od zakresu): osobny checkbox dla każdej kolumny, oznaczony kolorem grupy (Ciało, Aktywność, Energia, Jedzenie, Kontekst — opaska, Opis dnia — uwagi, notatka); wybór zapamiętany w przeglądarce (dawny zapis grup przechodzi na ich kolumny). Wiersz grup nad kolumnami pokazuje tylko grupy z widocznymi kolumnami. Tabela wypełnia obszar pod nagłówkiem bez marginesów (od krawędzi do krawędzi, bez zaokrągleń; na telefonie bez zmian). Pusty pasek przewijania strony jest tu przezroczysty (miejsce zostaje, układ nie przeskakuje między widokami); paski w całej aplikacji są cienkie, w kolorach motywu. Zamrożony nagłówek i kolumna daty; przy sortowaniu po dacie wiersze tygodni „średnie dzienne” (średnia z dób potwierdzonych, bez liczby dób). Dzisiejszy wiersz bez znacznika „w toku” (wartości częściowe są przygaszone). Bez filtra dni z uwagami i bez legendy.
- Kolumny „Inne wskaźniki” w grupie Ciało (2026-11-06): tętno spoczynkowe, HRV, SpO₂, oddechy, temperatura skóry w nocy, VO₂max — dobowe podsumowania producenta ze snapshotu doby, jedna wartość główna na typ (jednostka w nagłówku). Różne punkty doby to zakres „najmniejsza–największa”, brak wartości to „—”. Kolumny są sortowalne (doby bez wartości lub z zakresem zostają na końcu w obu kierunkach) i mają średnią dzienną w wierszach tygodni, liczoną tylko z dób z jedną wartością (bez konfliktów); nie wchodzą do zakresu „Od początku”, trendów ani kart telefonu; można je ukryć w menu „Kolumny”.
- Wiersze są wirtualizowane; ukryte wiersze wymiarujące o zerowej wysokości trzymają najszerszą treść każdej kolumny z całego zakresu, więc szerokość tabeli i poziome przewinięcie nie zależą od tego, które wiersze są wyrenderowane. Po pierwszym renderze szerokości kolumn są mierzone i ustalane (zaokrąglone), aż zmienią się dane, widoczne kolumny, sortowanie po dacie albo szerokość widoku.
- Kliknięcie wiersza lub komórki otwiera dzień. Na telefonie lista kart dni.
- Eksport CSV jeszcze nie istnieje (przycisk usunięty z paska; pozycja w [etapie Q](../plan/09-quality-operations.md#interfejs-eksport-i-kopia-z-ui-przeniesione-z-m1)).

### Trendy

Ten sam wybór zakresu co w tabeli oraz agregacja Dni albo Tygodnie (tydzień bledszy przy mniejszej liczbie dób z wartością). Karty sześciu metryk (kolejność jak w dniu) i tętna (kreska min–maks. dnia, linia średniej okien) ze średnią okresu w nagłówku; dzisiejsza doba nie wchodzi do średnich sum. Placeholdery: tętno spoczynkowe (M2, osobny typ API, nie liczone z okien) i „Porównania i korelacje”. Słupki od zera dla sum, linia łącząca dni z pomiarem dla masy i tkanki. Legenda: starszy model kalorii, okres nieporównywalny, prognoza do 24:00. Zdarzenia na osi wyliczane z całej historii: okresy samej energii bazowej, doby sprzed importowanej historii, pierwsza doba pełnego modelu kalorii (bez „początku opaski”, bo próg noszenia nie jest ustalony).

### Źródła danych

- **Połączenia:** Google Health API (stan, zakresy, ostatni odczyt, „Odśwież teraz”), Google Takeout, przyszłe źródła jako opisy.
- **Pokrycie historii:** kalendarz roku (doba pokryta, gdy wszystkie rodzaje objął pełny odczyt po jej końcu; kolor pośredni — część rodzajów), postęp według rodzaju, uzupełnianie od wybranej daty. Zakończenie uzupełniania zgłasza globalne powiadomienie.
- **Importy plików:** import CSV z mapowaniem i listą importów (wycofanie/przywrócenie), import Takeout (ZIP), oryginalne wiersze Takeout.
- **Diagnostyka:** zadania odczytu i „Odczyt próbny”.

### Ustawienia

Strefa doby jest edytowalna (lista stref, potwierdzenie z opisem przeliczenia, „Dokończ przeliczanie” po przerwie); wartości tylko do odczytu: precyzja, tydzień od poniedziałku; polecenia CLI kopii i sprawdzenia odtworzenia.

## Interakcje wykresów

Kliknięcie wykresu lub karty otwiera powiększenie (Esc zamyka). Tooltip po najechaniu obejmuje całą kolumnę dnia lub godziny i jest krótki: data/zakres godzin i wartość z jednostką; dla kalorii także źródło szacunku (opaska / telefon / mieszane) i udział opaski, dla dzisiejszych spalonych kalorii prognoza. Tooltip uzupełnia tabele danych, nie zastępuje ich.

## Język wizualny

- **Kolory grup:** energia pomarańczowy, aktywność morski (też kolor akcji), ciało niebieski, tętno/opaska lawendowy, jedzenie limonkowy. Stany osobno: żółty — uwagi i konflikt, czerwony — błąd i luka.
- **Stany wartości:** potwierdzona — sama liczba; częściowa — przygaszona, „w toku”; nieporównywalna — „—” z kreskowanym znacznikiem; konflikt — żółty znacznik; brak — „—”, nigdy 0. Na wykresach: półprzezroczysty słupek doby częściowej, kreskowanie starszego modelu i okresów nieporównywalnych.
- **Typografia (zatwierdzone):** Bricolage Grotesque (nagłówki), IBM Plex Sans (interfejs, cyfry tabelaryczne), IBM Plex Mono (daty, etykiety). SIL OFL, lokalne pliki.
- **Precyzja (zatwierdzone):** masa 0,1 kg, tkanka 0,1 %, dystans 0,01 km — tylko prezentacja.
- Liczby pl-PL, jednostki w nagłówku kolumny lub przy wartości. Pasek przewijania ma stałe miejsce (`scrollbar-gutter`).

## Otwarte pytania

- Kolumna „Źródła”: pełne nazwy (dziś) czy skróty.
- Prognoza kalorii: oceniona i wdrożona jako `prognoza-bez-wysilku-v2` ([wykonane](../completed/02-m1.md#prognoza-spalonych-kalorii--wykonane-2026-11-06)); profil per dzień tygodnia dopiero po ≥ 8 tygodniach historii.
