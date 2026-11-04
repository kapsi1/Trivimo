# Projekt UI — propozycja

Stan: propozycja z 2026-11-04, częściowo zaakceptowana przez użytkownika tego samego dnia (widok startowy, precyzja masy, kroje pisma, prognoza kalorii, interakcje wykresów; zob. [decyzje](../decisions.md)). Nie jest opisem implementacji. Interaktywny prototyp na danych syntetycznych: [ui-prototype.html](ui-prototype.html), opublikowany jako prywatny [artefakt](https://claude.ai/artifact/PbNSGrNRUVXLGGNt1kaVSU). Reguły danych z [kontraktów](../data-contracts.md) mają pierwszeństwo przed tym projektem.

## Cel i założenia

- Jeden użytkownik, desktop w przeglądarce, ciemny motyw (decyzja 3). Telefon: podstawowy odczyt i w przyszłości szybkie wpisy jedzenia.
- Główna praca to przegląd dnia, porównanie dni i sprawdzenie pochodzenia wartości. Diagnostyka odczytów jest potrzebna rzadko, więc nie zajmuje głównych widoków.
- Stan wartości widać w formie, nie tylko w tekście: brak, częściowy, nieporównywalny i konflikt mają stałe oznaczenia we wszystkich widokach.

## Nawigacja

Stała lewa nawigacja zastępuje prowizoryczne zakładki (w tym „Przykład”). Na wąskim ekranie dolny pasek: Dzień, Dni, Trendy, Jedzenie, Więcej.

| Grupa | Pozycja | Stan |
| --- | --- | --- |
| Dane | Dzień, Tabela dni, Trendy | M1 |
| Dane | Treningi | placeholder M2 |
| Jedzenie | Dziennik, Produkty i przepisy | placeholder M3 |
| Jedzenie | Planer | placeholder M4 |
| System | Źródła danych, Ustawienia | M1 |

Stopka nawigacji pokazuje stan synchronizacji (ostatnie odświeżenie, harmonogram) i ostatnią kopię zapasową. Kliknięcie prowadzi do „Źródeł danych”. Globalny błąd sieci jest stanem synchronizacji, nie uwagą przy każdym dniu.

Pasek górny ma tytuł widoku, kontekst daty lub okresu danego widoku oraz przycisk „Dodaj” (notatka do dnia; „Posiłek” M3 i „Pomiar wagi” M7 jako nieaktywne pozycje). Adresy widoków przez hash (`#dzien`, `#tabela`, …), żeby dało się wrócić do konkretnego widoku.

## Widoki

### Dzień (ekran startowy — zatwierdzone)

Wybór dnia strzałkami, polem daty, „Dziś”, a z klawiatury ←/→ i `t`. Nagłówek pokazuje „w toku · stan na HH:MM” dla bieżącej doby i „doba 23 h / 25 h” przy zmianie czasu. Strefa czasowa nie jest wyświetlana w nagłówkach ani opisach; widać ją tylko w ustawieniach (decyzja z 2026-11-04). Zakładki: Podsumowanie, Przebieg doby, Pochodzenie danych, Jedzenie (M3), Treningi (M2).

- **Podsumowanie:** karty metryk w czterech grupach — Energia, Aktywność, Ciało i Jedzenie (placeholder: spożyte kalorie, bilans). Karta ma wartość, stan, porównanie ze średnią 7 dni z liczbą dób potwierdzonych („6 z 7 dób”) i miniwykres 14 dni (dla masy i tkanki linia łączy dni z pomiarem, bez przerw). Dla masy i tkanki bez pomiaru karta pokazuje „ostatni pomiar … · data”, nie przenosi go na dzień. Grupa Ciało ma też kartę „Tętno”: średnia okien z pomiarem, obok zakres min–maks., porównanie ze średnią 7 dni i miniwykres 14 dni (kreska min–maks., linia średniej); powiększenie pokazuje 7 / 14 / 30 / 90 dni. Pod kartami „Doba w skrócie” (spalone kcal na godzinę z podziałem na aktywne i pozostałe, mały wykres tętna), uwagi automatyczne i edytowalna „Moja notatka”. Bez osobnego paska okien „HR” i opisu udziału opaski pod wykresem: udział opaski jest w tooltipie kalorii i w kolumnie „Opaska” tabeli.
- **Prognoza spalonych kalorii (doba w toku):** karta „Spalone kalorie” pokazuje w tym samym wierszu co wartość „Prognoza: X kcal”. Na wykresach godzinowych reszta bieżącej godziny i przyszłe godziny są przerywanymi słupkami, a na wykresach dni przerywany obrys nad dzisiejszym słupkiem. Metoda: spalone do teraz + stawka spoczynkowa × pozostały czas doby (23/25 h przy zmianie czasu). Stawka pochodzi z dzisiejszych okien 10-minutowych bez kroków i bez aktywnych kcal. To własna, nazwana i wersjonowana pochodna (`prognoza-spoczynek-v0`), nie wartość producenta ani BMR. Nie trafia do tabeli, średnich ani eksportu. Panel „?” opisuje założenie: rzeczywista wartość zwykle będzie wyższa. Dokładną regułę wyboru okien (np. minimalna liczba okien, okna nocne) trzeba ustalić na danych przed implementacją.
- **Przebieg doby:** wykres godzinowy z przełącznikiem metryki i tabela danych godzinowych (dostępność). Dla starszego modelu kalorii zamiast wykresu wyjaśnienie braku rozkładu. Pod spodem wykres tętna (realizuje punkt MVP „seria tętna w widoku dnia”).
- **Tętno w dniu:** okna 10-minutowe z rollUp: pas min–maks. i linia średniej okna, na tej samej osi godzin co pozostałe wykresy. Okna bez pomiaru to przerwy, bo w ciągu doby oznaczają brak opaski. Nagłówek: średnia okien, min–maks. i liczba okien z pomiarem. Mały wykres tętna jest też w „Dobie w skrócie”. Tooltip: zakres 10 minut, średnia, min–maks.
- **Pochodzenie danych:** źródła wpisów dnia z rolą (wybrane przez producenta, kopia, replika niedoliczana), reguły i rewizja wyniku, historia odczytów doby.

### Tabela dni

- Zakres: 7 / 30 / 90 dni / rok; filtr „Tylko dni z uwagami”; przełączanie grup kolumn (zapamiętywane w przeglądarce); eksport CSV nieaktywny do czasu realizacji.
- Grupy kolumn z kolorem grupy: Ciało, Aktywność, Energia, Jedzenie (jedna kolumna-placeholder „Spożyte kcal”, M3), Kontekst (opaska z paskiem udziału, źródła), Opis dnia (uwagi, notatka).
- Zamrożony nagłówek i kolumna daty. Przy sortowaniu po dacie wiersz tygodnia ze średnią dzienną z dób potwierdzonych i liczbą dób z wartością („5/7”), zamiast pozornej średniej z braków.
- Kliknięcie komórki otwiera boczny panel szczegółów zamiast sekcji pod tabelą, więc tabela zostaje na miejscu.
- Na telefonie lista kart dni; karta otwiera widok dnia.

### Panel szczegółów wartości

Wspólny dla tabeli i kart dnia: wartość i stan z powodem, „Skąd ta wartość” (źródło, reguła), część zależna od grupy (model i źródło szacunku kalorii z podziałem aktywnych kcal na okna z tętnem i bez; uzgodnienie źródeł kroków; pomiary dnia i kopie dla masy), odczyty, porównanie z Takeout, uwagi dnia, rewizja oraz przejście do dnia lub jego pochodzenia. To realizuje punkt MVP „kliknięcie komórki: oryginalna wartość źródła, czas odczytu i porównanie API/Takeout”.

### Interakcje wykresów (zatwierdzone)

Dotyczy wykresów w widokach Dzień i Trendy.

- **Kliknięcie wykresu powiększa go** w oknie nad widokiem. Karta metryki w Dniu otwiera historię wokół wybranego dnia (7 / 14 / 30 / 90 dni, wybrany dzień wyróżniony). Wykres godzinowy otwiera się z przełącznikiem metryki i z linią tętna (średnie okien 10-min) na tym samym wykresie, ze skalą w bpm po prawej; tooltip godziny dodaje średnie tętno. Tytuł powiększenia odpowiada wykresowi źródłowemu („Doba w skrócie” albo „Przebieg doby”). Wysokość okna jest stała przy przełączaniu metryk. Wykres trendu z tymi samymi przyciskami zakresu co widok Trendy (30 dni / 90 dni / Rok / Od 1 sty) oraz przełącznikiem dni / tygodni. Okno ma wąskie marginesy, żeby wykres zajmował jak najwięcej miejsca. Esc zamyka.
- **Ikona „?” w kółku w prawym górnym rogu** każdego wykresu i karty (także w powiększeniu) otwiera prawy panel z metadanymi: „Skąd ta wartość”, reguła, model, źródło szacunku, odczyty, Takeout, rewizja. Dla serii godzinowej i trendu panel opisuje serię: definicję, źródło, zgodność z dobą, pas opaski, zdarzenia na osi, sposób czytania i jednostkę. Kliknięcie komórki w tabeli dni nadal otwiera ten panel bezpośrednio.
- **Tooltip po najechaniu** na wartość jest krótki: data (albo zakres godzin, albo tydzień) i wartość z jednostką. Dla kalorii dodatkowo „Źródło: opaska / telefon / mieszane” i „Opaska: X %”, a dla dzisiejszych spalonych kalorii „Prognoza: X kcal”. Stan, powody i pozostałe metadane są w tabeli i w panelu „?”. Obszar najechania obejmuje całą kolumnę dnia lub godziny, nie tylko słupek. Tooltip uzupełnia tabelę danych godzinowych i panel, nie zastępuje ich (dostępność bez myszy).

### Trendy

Okres 30 dni / 90 dni / Rok (365 dni wstecz) / Od 1 sty oraz agregacja Dni albo Tygodnie (tydzień bledszy, gdy ma mniej dób z wartością). Dni przed 2026 są w zakresie „Rok” oznaczone jako niezaimportowana historia, a nie jako zera ani luki w odczytach. Osiem kart: sześć metryk M1, tętno (pionowa kreska min–maks. dnia, linia średniej okien łącząca dni z pomiarem) i placeholder tętna spoczynkowego (M2; osobny typ API, nie wyliczany z okien). Wartości dnia tętna to min, maks. i średnia średnich okien — własna agregacja do prezentacji, nie tętno spoczynkowe. Wykresy metryk: słupki od zera dla sum, linia dla pomiarów, łącząca dni z pomiarem (kropka oznacza dzień z pomiarem; brak nie jest wartością). Bez stałego bloku „Jak czytać”; legenda zostaje tylko dla oznaczeń (starszy model, okres nieporównywalny, prognoza), a objaśnienia są w panelu „?”. Nagłówek karty ma średnią z dób potwierdzonych i ich liczbę. Zdarzenia na osi zamiast niewidocznych skoków: okres samej energii bazowej (kreskowany), początek opaski i pełnego modelu kalorii, pierwsze ważenie; słupki starszego modelu kalorii kreskowane.

### Źródła danych

Zakładki zamiast jednej długiej strony:

- **Połączenia:** karty Google Health API (stan, zakresy, ostatni i następny odczyt, co jest odświeżane, „Odśwież teraz”), Google Takeout, oraz przyszłe: Health Connect (M8), źródła jedzenia (M3–M4), zapis do Google/Connect (M7).
- **Pokrycie historii:** kalendarz 2026 z dobami pokrytymi odczytem po końcu doby i lukami, postęp według rodzaju odczytu, „Uzupełnij luki”.
- **Importy plików:** import Takeout z podglądem przed zapisem i historia importów.
- **Diagnostyka:** zadania odczytu, zwinięty „Odczyt próbny” i dziennik zdarzeń (limity 429, kopie). Tu trafia to, co dziś jest w głównej zakładce Google.

### Ustawienia

Strefa dnia, precyzja prezentacji, pierwszy dzień tygodnia, kopie zapasowe (lokalizacja, ostatnia kopia, „Utwórz kopię teraz”), cele kalorii i makr (placeholder M4), prywatność.

### Placeholdery jedzenia i treningów

Widok „Jedzenie” ma zakładki Dziennik, Produkty i przepisy, Planer, Importy; każda to opis zakresu z etykietą etapu. Treningi i zakładki dnia „Jedzenie” / „Treningi” tak samo. Szczegóły zaprojektujemy razem z etapami M2–M4.

## Język wizualny

- **Kolory grup:** energia pomarańczowy, aktywność morski (też kolor akcji), ciało niebieski, tętno/opaska lawendowy, jedzenie limonkowy (tylko placeholdery). Kolory stanów osobne: żółty dla uwag i konfliktu, czerwony dla błędu i luki.
- **Stany wartości:** potwierdzona — sama liczba; częściowa — przygaszona liczba i znacznik „w toku”; nieporównywalna — „—” i kreskowany znacznik; konflikt — żółty znacznik; brak — „—”, nigdy 0. Na wykresach: półprzezroczysty słupek dla doby częściowej, kreskowanie dla starszego modelu i okresów nieporównywalnych.
- **Typografia (zatwierdzone):** Bricolage Grotesque (nagłówki), IBM Plex Sans (interfejs, cyfry tabelaryczne), IBM Plex Mono (daty, etykiety, identyfikatory reguł). Wszystkie na licencji SIL OFL; w aplikacji dołączyć jako lokalne pliki zamiast Google Fonts, żeby lokalna aplikacja nie łączyła się z zewnętrznym serwerem.
- **Precyzja (zatwierdzone):** masa 0,1 kg, tkanka tłuszczowa 0,1 %, dystans 0,01 km; tylko prezentacja, przechowywanie dokładne.
- Liczby w formacie pl-PL, jednostki zawsze widoczne w nagłówku kolumny lub przy wartości.

## Różnice względem planu MVP

- „Przegląd” dzieli się na **Dzień** i **Trendy**; „Dane” to **Tabela dni**; „Źródła/Importy” to **Źródła danych** z zakładkami. Ustawienia jak w planie.
- Szczegóły komórki w panelu bocznym zamiast pod tabelą.
- Wiersze tygodni z pokryciem w tabeli i agregacja tygodniowa w trendach — nowe propozycje.
- Zdarzenia na osi trendów realizują zasadę z [planu analiz](../plan/04-ui-workouts.md): zmiana algorytmu lub urządzenia jest oznaczeniem, nie niewidocznym skokiem.

## Otwarte pytania

- Kolumna „Źródła” w tabeli: pełne nazwy (dziś) czy skróty z pełną listą w panelu szczegółów.
- Reguła wyboru okien do stawki prognozy kalorii (do ustalenia na danych przed implementacją).
