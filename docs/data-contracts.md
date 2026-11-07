# Kontrakty danych

Obowiązujące reguły semantyki. Jedna wersjonowana definicja obejmuje 2026 i kolejne dni; doby sprzed 2026 odczytane z API są kwalifikowane tymi samymi regułami (decyzja 2026-11-04), bez osobnego audytu tych lat. Dane źródłowe pozostają dostępne także wtedy, gdy nie kwalifikują się do tabeli. Obserwacje, z których wyprowadzono reguły: [obserwacje z danych](completed/03-data-findings.md).

## Oryginał, kopia, wynik i korekta

1. Transport ≠ urządzenie pomiarowe. Dane z telefonu/Connect nie muszą pochodzić z telefonu; pole zapisane przez Health nie dowodzi noszenia opaski. Producenta, urządzenie, metodę i rodzinę źródła zapisuj, gdy są dostępne; inaczej „nieznane”.
2. Tożsamość źródłowa: dostawca + konto + typ + oryginalne ID. Bez ID — jawny wersjonowany klucz z danych rekordu, nie numer wiersza ani nazwa pliku. Hash treści to rewizja, nie ID. Zachowuj precyzję czasów i liczb.
3. API i Takeout mogą zawierać ten sam pomiar w innej jednostce/precyzji. Łącz tylko po jednoznacznym dopasowaniu lub decyzji; nie dodawaj. Własny zapis odczytany z Connect/API to replika.
4. Priorytet stosuj tylko między równoważnymi kandydatami. Nowszy czas importu nie dowodzi nowszego pomiaru.
5. Edycja użytkownika tworzy wersję/korektę powiązaną z oryginałem. Eksport do dostawcy jest osobną operacją.
6. Warstwa pochodna (np. sparsowane okna stron Google, magazyn v13) to pamięć podręczna w bazie: wyznacza ją oryginał i wersja parsera, nigdy go nie zastępuje; niezgodność z oryginałem to błąd weryfikacji magazynu.

## Stany i kompletność

Wartość jest oddzielona od statusu (`valid`, `provisional`, `missing`, `incomplete`, `incomparable`, `conflict`, `stale`, `unsupported`, `permission_denied`, `source_error`; implementacja może rozdzielić jakość, świeżość i dostęp). `null` ≠ 0. Potwierdzone zero z obsługującego je źródła zachowaj z dowodem; pusta lista, błąd ani OAuth go nie dowodzą.

Po przejściowym błędzie zostaje ostatni potwierdzony wynik z oznaczeniem nieaktualności. Dyskwalifikacja po nowej kompletnej ocenie może wyczyścić wynik kanoniczny, zachowując wersje i przyczynę. Usunięcie ze źródła potwierdza tombstone albo pełna rekonsyliacja zakresu, nigdy pusty odczyt.

Brak HR nie dowodzi braku opaski, a jedna próbka nie dowodzi noszenia przez cały dzień. Doba w toku jest częściowa i wyłączona z porównań pełnych dób.

## Czas, jednostki i agregacja

- Przechowuj czas UTC, oryginalny offset/strefę, datę cywilną źródła i regułę przypisania dnia. Dzień aplikacji: doba w strefie z ustawienia (reguła `day-zone-v1`, domyślnie Europe/Warsaw, zob. [strefa doby](#strefa-doby-day-zone-v1)), przedział `[start, end)`, bez założenia 86 400 s. Strefa nie zmienia się niejawnie podczas podróży.
- Doba cywilna producenta nie musi równać się przedziałowi UTC doby w strefie ustawienia. Gdy nie da się tego potwierdzić, wynik jest nieporównywalny z uwagą, a nie podmieniany.
- Jednostki wewnętrzne jawne; zachowaj dokładną liczbę i jednostkę źródła, zaokrąglaj tylko w prezentacji. kJ/kcal, procent/ułamek, mg/g, milli-breaths/min wymagają testów.
- Reconciliation dostawcy ≠ suma surowych rekordów. Ten sam dzień daje ten sam wynik niezależnie od porcji zapytania.
- Sen przypisuj według końca snu, z zachowaniem sesji i rozróżnieniem nocy/drzemki; nie sumuj nakładających się wersji algorytmu ani faz bez rozstrzygnięcia.
- Rodzina źródeł agregatów: wszystkie zapisane odczyty używają `all-sources` (stała `readSourceFamily` w adapterze), bez kolumny w zadaniu. Odczyt innej rodziny wymaga najpierw migracji zapisującej ją w zadaniu.

## Sześć metryk MVP

| ID i etykieta | Definicja kanoniczna | Braki / uwagi |
| --- | --- | --- |
| `weight_daily_mean`, Masa ciała, kg | Średnia unikalnych zaakceptowanych ważeń dnia | Ostatnia znana waga osobno, nie jako pomiar nowego dnia |
| `body_fat_daily_mean`, Tkanka tłuszczowa, % | Średnia unikalnych pomiarów procentowych dnia | Nie wyliczaj z BMI ani masy |
| `steps_daily`, Kroki, szt. | Wartość dobowa producenta po jego uzgodnieniu źródeł | Telefon nie jest wykluczany |
| `distance_daily`, Dystans, km | Wartość dobowa producenta, bez dodawania treningów | Nie zgaduj z liczby kroków |
| `total_energy_daily`, Spalone kalorie, kcal | Całkowity wydatek (bazowy + aktywny) według `google-energy-v1` | Sam BMR nie jest porównywalnym total |
| `active_energy_daily`, Aktywne kalorie, kcal | Energia ponad bazową według modelu producenta | Brak ≠ zero; legacy `activityCalories` nie jest zamiennikiem |

## Kalorie — zasady

Szacunek telefonu bez opaski jest porównywalny z opaską, jeśli źródło szacunku jest jawnie oznaczone (decyzja 2026-11-03). Pokazywane wartości pochodzą od producenta; nie zastępuj braków własnym modelem ani wyliczeniem z kroków. Nie wymagaj instalacji Fit.

- Raw BMR/total/active to osobne typy. `total − active` nie jest BMR; nie odejmuj stałej ani BMR z innej daty/źródła.
- Stała wartość jest sygnałem do analizy pochodzenia, nie regułą usuwania. Sam BMR, niepełny zakres lub nieporównywalny model blokują kwalifikację.
- Nie sumuj kalorii treningów, aby uzyskać active dnia. Strefy HR/AZM służą analizie, nie odtworzeniu modelu producenta.
- Własny model wymaga osobnej nazwy, wersji i walidacji; nie trafia do tych kolumn.

### Reguła `google-energy-v1` (2026-11-03)

Wartości to sumy dobowe producenta (`dailyRollUp`, `all-sources`), równe sumom okien 10-minutowych doby aplikacji (w strefie ustawienia). Model doby rozpoznaje się z okien `total-calories` i aktywnej energii:

- **sam BMR** (tylko doba zakończona): brak aktywnych kcal albo zero, okna pokrywają ≥ 90 % doby, a okna istotne (> 1 % największego okna) w ≥ 95 % mieszczą się w 1 % od mediany. Total poza tabelą, uwaga „tylko energia bazowa”. Sama równość sumy ze stawką BMR niczego nie dowodzi.
- **pełny model**: producent podaje aktywne kcal (od 2026-05-07). Cicha doba telefonu z niezerowymi aktywnymi kcal to prawdziwy total.
- **starszy model**: brak aktywnych kcal i mniej niż połowa okien doby (kilka długich przedziałów; 2026-01-01 – 2026-04-07). Wartość bez uwagi i bez kalorii aktywnych; model w snapshocie, wykresy oznaczają te doby.
- **nieustalony**: pozostałe przypadki i doba bez odczytu okien; total nieporównywalny.

Źródło szacunku: brak odczytu tętna — nieznane (nieporównywalne); 0 okien z tętnem — „telefon”; wszystkie — „opaska”; pozostałe — „mieszane” z udziałem. Udział opaski to okna z tętnem / okna doby (144; 138 lub 150 przy zmianie czasu), a aktywne kcal dzielone są na okna z tętnem i bez. Okna liczą każde tętno, także pomiar aparatem telefonu, więc udział jest górnym oszacowaniem. Doba w toku jest częściowa bez uwagi (progi liczone względem okien, które minęły); zakończona doba odczytana przed końcem — częściowa z uwagą „niepełny zakres”; zakończona odczytana po końcu — od razu potwierdzona. Jawne zero producenta to potwierdzone zero. Progi 90/95/1/50 % wyznaczono na danych 2026; zmiana progu lub znaczenia to nowa wersja reguły.

### Reguła `google-activity-v1` (2026-11-03)

Kroki i dystans to wartość dobowa producenta (`dailyRollUp`, `all-sources`; dystans z mm na km dokładnym przesunięciem przecinka); producent nie sumuje replik źródeł. Wartość należy do doby aplikacji, gdy suma okien 10-minutowych tej doby jest jej dokładnie równa; przy niezgodności — nieporównywalna z uwagą „inny lub nieustalony dzień źródła”, bez odczytu okien — granica nieustalona. Dla doby w toku zgodność się zakłada. Stany częściowe i zero jak w `google-energy-v1`; brak odczytu to brak danych.

### Reguła `google-body-v1` (2026-11-04)

Masa i tkanka tłuszczowa z `list` API (`weight`, `body-fat`); pomiar należy do doby swojego `sampleTime.physicalTime`. Zachowany jest tekst liczby źródła; gramy → kg dokładnym przesunięciem przecinka. Rekordy w odstępie ≤ 1 s i z różnicą < 1 g (tłuszcz: < 0,01 p.p.) to jeden pomiar (ID: najmniejsza nazwa rekordu). Ten sam moment z wyraźnie różną wartością to konflikt (bez średniej, uwaga „niejednoznaczne pomiary”); nieczytelna wartość lub brak nazwy — wartość nieprawidłowa. Wartość dnia: średnia unikalnych pomiarów; doba bez pomiarów to brak, nie poprzednia waga. Takeout nie jest łączony z API (te same pomiary), służy do porównania.

### Źródła dnia (magazyn v10)

Kroki i kalorie aktywne są dodatkowo czytane metodą `list` z `fields=dataPoints(dataSource,<pole>(interval(civilStartTime(date)))),nextPageToken` — tylko źródło i dzień cywilny wpisu, bez wartości. Źródło to `platform`, `application.packageName`, urządzenie i `recordingMethod`. Kolumna „Źródła” zlicza wpisy najnowszego pełnego odczytu doby; bez odczytu „—”, odczyt bez wpisów — „brak wpisów”. Nazwy: `FITBIT` + urządzenie → „Opaska …”; `FITBIT` + `MobileTrack` → telefon w aplikacji Health; `HEALTH_CONNECT` + `com.google.android.apps.fitness` → Google Fit; `HEALTH_CONNECT` + `android` / `com.android.healthconnect.phone` → krokomierz Androida. Źródło mówi, kto policzył wpis; repliki uzgadnia producent. Kalorii total nie da się listować.

### Historia sprzed 2026 (2026-11-04)

Odczyt API wcześniejszych lat uruchamia użytkownik datą początkową uzupełniania (najwcześniej 2000-01-01); automatyczne wykrywanie luk dotyczy dób od 2026-01-01. Pusta odpowiedź to „odczytana, brak danych”, nie zero. Doby kwalifikują reguły 2026, więc brak aktywnych kcal i okien daje starszy lub nieustalony model; trafność progów dla starszych urządzeń jest niesprawdzona.

### Reguła `csv-fill-v1` — import CSV (2026-11-04)

- Plik (UTF-8, ≤ 8 MiB, 200 000 wierszy, 256 kolumn) zachowany w bazie ze skrótem SHA-256, mapowaniem i wersją parsera (`csv-mapped-v1`; `v2`: „%” po wartości i kolumna uwag; `v3`: grupy cyfr ze spacją). Starsze importy zachowują swoje wartości. Ten sam plik z tym samym mapowaniem nie jest zapisywany ponownie. Treść pliku jest niezaufana.
- Mapowanie wybiera użytkownik: kolumna i format daty (`RRRR-MM-DD`, `DD.MM.RRRR`, `DD/MM/RRRR`, `MM/DD/RRRR`, ISO 8601), opcjonalna godzina, separatory, kolumna i jednostka metryk. Data bez strefy to doba z pliku; ISO ze strefą trafia do doby w strefie aktywnej w chwili importu (przypisanie zapisane w wartościach, nie przeliczane po zmianie strefy). Doby przed 2000-01-01 i przyszłe są odrzucane.
- Przeliczenia dokładne (liczby wymierne): lb × 0,45359237, g ÷ 1000, mile × 1,609344, m ÷ 1000, kJ ÷ 4,184, ułamek × 100. Kroki całkowite, tłuszcz ≤ 100 %. Grupy cyfr po trzy (spacja, U+00A0, U+202F, U+2009); nieregularne odrzucane. „%” po wartości tylko przy jednostce `%`. Pusta komórka to brak, jawne 0 to wartość; nieczytelna komórka odrzuca tylko tę wartość (wiersz i powód w podglądzie).
- Masa/tłuszcz: średnia unikalnych pomiarów (ta sama doba, godzina i wartość to jeden pomiar, także między plikami). Kroki, dystans, kalorie: kilka wierszy doby to kopie (różne wartości = konflikt); sumowanie wymaga wyboru „części doby”. Różne sumy tej samej doby z różnych plików to konflikt.
- CSV **uzupełnia tylko braki**: wartość trafia do snapshotu wyłącznie dla metryki o stanie `missing` w projekcji Google. Snapshot zapisuje, które metryki i importy go uzupełniły (UI od 2026-11-05 tego nie pokazuje).
- Kolumna uwag: niepusta komórka (≤ 10 000 znaków) staje się notatką dnia w tej samej transakcji — nowa notatka albo dopisana linia w nowej rewizji; tekst już obecny niczego nie zmienia. Rewizje z importu oznacza `user_note_sources` (v12). Uwagi nie zmieniają metryk.
- Wycofanie/przywrócenie importu to wersjonowana decyzja obejmująca wszystkie jego dane, po której doby są przeliczane. Wycofanie usuwa z bieżącej notatki linie dopisane przez import (rewizja `withdraw`), pozostawiając edycje użytkownika. Doba zasilana tylko wykluczonym CSV dostaje pustą rewizję. Oryginał nie jest usuwany.

### Pochodne prezentacyjne UI (2026-11-04)

### Strefa doby (`day-zone-v1`)

Wykonane 2026-11-06 (magazyn v14). Jedna strefa globalna dla całej aplikacji, ustawienie w bazie (`day_zone_versions`: numer wersji, nazwa IANA w dokładnej pisowni znanej środowisku wykonawczemu, reguła, powód `initial`/`user`, czas). Wersja 1 to Europe/Warsaw — tak liczono wszystkie doby do tej pory. Doba to `[północ lokalna, następna północ)` (23, 24 lub 25 godzin; gdy północ nie istnieje, doba zaczyna się od pierwszej chwili tej daty).

- **Zależy od strefy:** granice doby, przypisanie chwili z offsetem (próbki wagi i tłuszczu, Takeout, CSV ISO) do doby, zadania odczytu trzymające granice UTC doby (`*-10m`, `weight`, `body-fat`: granice z chwili odczytu), „dziś”, godziny zegara ściennego (prognoza, etykiety godzin), pokrycie historii i plan odczytów. **Nie zależy:** sumy dobowe producenta (jego daty cywilne); porównanie z oknami doby aplikacji daje `zone_interval` albo nieporównywalność „inny lub nieustalony dzień źródła”.
- **Snapshot** zapisuje `zone`; brak pola oznacza Europe/Warsaw (snapshoty sprzed v14). Strefa jest częścią treści snapshotu: ta sama doba cięta inaczej to nowa rewizja.
- **Zmiana strefy** dodaje wersję ustawienia i przelicza opublikowane doby z zapisanych oryginałów jako nowe rewizje; poprzednie rewizje i oryginały zostają. Doba bez pełnego odczytu w nowej strefie (okna z granicami starej strefy jej nie pokrywają) jest nieporównywalna albo pusta do ponownego odczytu okien (uzupełnianie historii) — nigdy zero. Powrót do poprzedniej strefy przywraca wartości z zachowanych odczytów. Przerwane przeliczenie wznawia to samo żądanie (stan `staleDays` pokazuje doby z innej strefy). Zmiany odmawia się, gdy trwa odświeżanie lub uzupełnianie.
- **Poza zakresem tej wersji:** strefa przypisana do doby (podróże: doba zapisana tam, gdzie mierzono); wartości CSV (`csv_import_values.day`) i notatki dnia (klucz = data) zachowują dobę przypisaną w chwili importu/zapisu i nie są przeliczane po zmianie strefy. Strefy bez godzinowych przesunięć okien (np. +5:45) nie mają osobnego testu poza dobą 24 h; wyrównanie okien producenta do UTC w takich strefach niepotwierdzone.

- Tętno: `beatsPerMinuteAvg/Min/Max` z okien `heart-rate-10m`; brak min/maks. zastępuje średnia okna. Doba: min i maks. okien oraz średnia średnich (nieważona). Nieodczytana doba ≠ doba bez okien; żadna z tych wartości nie jest tętnem spoczynkowym.
- `prognoza-spoczynek-v0` (tylko bieżąca doba): suma dzisiejszych okien total + średnia total okien bez kroków i bez aktywnych kcal × okna do końca doby (23/25 h przy zmianie czasu). Wymaga odczytu okien kroków i aktywnych kcal oraz ≥ 6 okien spoczynkowych. Nie jest wartością producenta ani BMR; nie trafia do tabeli, średnich ani eksportu.
- `prognoza-bez-wysilku-v2` (tylko bieżąca doba, od 2026-11-06; zastępuje krótko wdrożoną `prognoza-profil-v1`): spalone dotąd (suma dzisiejszych okien total) + dla każdego okna do końca doby średnia total okien tej samej godziny zegara ściennego w strefie doby z ostatnich 14 kompletnych dób (z 21 ostatnich; minimum 7), liczona tylko z okien bez znaczących kalorii aktywnych (aktywne ≤ 3 kcal na okno; brak okna aktywnych to brak aktywności). Doba historii jest kompletna, gdy ma wszystkie okna total i odczytane okna aktywnych kcal. Godzina z mniej niż 10 oknami codziennymi, za mało dób historii lub brak okien total → v0 z własną etykietą (nigdy zero). Wynik nie jest niższy niż `prognoza-spoczynek-v0` („co najmniej”); okna do końca doby są rozciągane do tej granicy. Wymaga tylko okien total dnia. To prognoza „bez znaczącego wysiłku”: nie zna planów dnia i nie przewiduje treningu. Nie jest wartością producenta; nie trafia do tabeli, średnich ani eksportu; nie jest zapisywana, więc zmiana reguły nie wymaga migracji. Doby 23/25 h: godziny po zegarze ściennym, okno po oknie.

## Dobowe podsumowania producenta (`google-daily-summaries-v2`, 2026-11-06; v1 bez stanu `agreed`)

Tętno spoczynkowe, HRV, SpO₂, oddechy, temperatura w nocy i VO₂max (typy `daily-*`) to wartości doby policzone przez Google. Aplikacja ich nie przelicza z próbek i nie traktuje jako metryk M1; nie wchodzą do trendów, porównań ze średnią 7 dób ani zakresu „Od początku”. Od 2026-11-06 (decyzja użytkownika) tabela dni pokazuje je jako kolumny „Inne wskaźniki” w grupie Ciało, z sortowaniem i średnią tygodniową. Wartość główna to jedno pole typu (tętno, średnie HRV, średnie SpO₂, oddechy, temperatura nocy, VO₂max); różne punkty doby to w komórce zakres najmniejsza–największa. Sortowanie i średnia tygodniowa (arytmetyczna z wartości głównych) obejmują tylko doby `value` i `agreed`: doby z konfliktem, bez wartości i nieodczytane są pomijane (na końcu listy, poza średnią), nigdy nie liczą się jako zero; wchodzą do snapshotu doby jako osobna sekcja `summaries` (ta sama rewizja co wartości, jakość i uwagi). Reguły:

- **Odczyt:** `reconcile` dla `all-sources`, nie `list`: `list` zwraca punkt per źródło i ta sama doba może mieć dwie różne wartości (tętno spoczynkowe: źródła DERIVED i UNKNOWN). Strony sprzed zmiany, zapisane z `list`, zostają jako oryginały; nowszy odczyt zakresu je zastępuje w projekcji.
- **Stan typu w dobie:** `value` (jeden punkt), `absent` (pełny odczyt obejmował dobę i nie zwrócił punktu — nie zero), `conflict` (kilka różnych punktów tej samej doby; wszyscy kandydaci są zachowani w stałej kolejności, nic nie jest wybierane; sprawdzone: temperatura w nocy zwraca nawet z `reconcile` dwa punkty, z odchyleniem 30 d i bez). Typ nieodczytany nie jest wymieniany w sekcji. Identyczne powtórzenia łączą się w jeden punkt.
- **Zgodne pola (`agreed`, v2, decyzja użytkownika 2026-11-06):** tylko dla temperatury w nocy. Gdy doba ma kilka różnych punktów, a `nightlyTemperatureCelsius` jest w nich identyczne co do tekstu, snapshot ma stan `agreed`: `values` zawiera wyłącznie tę temperaturę, a `candidates` zostają. Punkt odniesienia (`baselineTemperatureCelsius`) i odchylenie 30 d nigdy nie są wybierane: u użytkownika oba punkty doby mają różny punkt odniesienia (dwa obliczenia, reguła producenta nieznana; dokumentacja v4 nie opisuje, ile punktów ma jedna data ani jak `reconcile` wybiera, sprawdzone 2026-11-06). Różna temperatura nocy to nadal `conflict`. Dla pozostałych typów reguły nie ma. Zmiana v1 → v2 zmienia treść snapshotów dób z sekcją (kolejna publikacja tworzy nową rewizję; oryginały bez zmian, migracja magazynu niepotrzebna).
- **`NaN`:** producent zapisuje liczbę, której nie policzył, jako tekst `"NaN"`; w polu opcjonalnym to brak pola, w wymaganym błąd strony (nic nie jest zapisywane jako zero). Inne teksty w polach liczbowych (np. `Infinity`) są błędem.
- **Wartości** zachowują zapis liczby producenta; zaokrąglenie jest tylko w wyświetlaniu. Doba bez odczytu energii i kroków nie dostaje własnego snapshotu z samych podsumowań. Doba dzisiejsza może mieć wartość wstępną (ponowny odczyt najwcześniej po 3 h).
- Zmiana znaczenia pola lub wyboru kandydata wymaga nowej wersji reguły i migracji.

## „Uwagi” i notatki

`DataIssue`: zakres dnia/sesji/metryki, stabilny kod, źródło, stopień, uzasadnienie, wersja oceny, stan. Kolumna „Uwagi” to deterministyczna projekcja problemów wszystkich metryk: stała kolejność, bez duplikatów przy odświeżeniu. Przykłady: „Kalorie: tylko energia bazowa”, „Aktywne kalorie: nieporównywalne źródło”. Nie pisz „brak opaski”, gdy wiadomo tylko o braku danych. Globalna awaria sieci to stan synchronizacji, nie uwaga każdego dnia.

Rozwiązana przyczyna znika z bieżącej projekcji, historia zostaje; błąd odczytu nie jest rozwiązaniem. Notatki użytkownika to osobna wersjonowana encja, której przeliczenie nie nadpisuje. Wartości, jakość i uwagi mają jedną rewizję w tabeli, szczegółach i eksporcie.

## Typy o podobnych nazwach

Daily HRV ≠ średnia próbek HRV; RMSSD ≠ SDNN. Nocne SpO₂ ≠ średnia chwilowych; granice ufności ≠ min/max. Tętno spoczynkowe ≠ minimum ani średnia HR. Delta temperatury skóry ≠ temperatura głęboka. AZM ≠ minuty treningu. Podsumowanie sesji ≠ suma dnia. Sleep efficiency ≠ ocena snu. Każda para ma osobne ID, etykietę i jednostkę. Źródła: [agregacja](https://developers.google.com/health/aggregate-data), [energia](https://developers.google.com/health/data-types/calories), [vitals](https://developers.google.com/health/data-types/vitals), [sen](https://developers.google.com/health/data-types/sleep), [schematy](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints).
