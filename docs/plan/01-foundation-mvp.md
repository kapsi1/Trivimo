# P0 / M1 — fundament i pierwsze sześć metryk

Cel: użyteczna tabela/wykresy dla 2026 i nowych dni, oparta na własnej bazie. Bez map, dziennika, AI i zapisów zewnętrznych jako warunku startu. [Kontrakty](../data-contracts.md) są obowiązujące; stos z [architektury](../architecture.md) jest propozycją.

## P0: przygotowanie i małe próby

Wykonane próby syntetycznego przepływu i parserów opisuje [P0 — wykonane](../completed/01-p0-probes.md). Pozostają m.in. trwała baza aplikacji i kopia przed przyszłymi migracjami; szczegóły i ograniczenia są w [raporcie](../test-results.md).

- [ ] W autoryzowanym etapie integracji skonfigurować osobnego klienta OAuth i próbę read-only kilku dni: rekordy waga/tłuszcz, kroki/dystans, total/active, pochodzenie. Sprawdzić `Operation`/metody tylko w dokumentacji; nie testować zapisu w tym etapie.
- [ ] Ustalić politykę kalorii na małej próbce: dzień z noszeniem, bez noszenia, niepełny, BMR-only i potwierdzone zero, jeśli występują. Oddzielić brak metadanych od braku pomiarów. Jeśli brak dowodu porównywalności, zachować lukę i opisać kryterium; nie wymyślać kwalifikatora dla pełności tabeli.
- [ ] Porównać API/Takeout dla tego samego konta, zakończonych dat, strefy, jednostek i wersji. Wynik próby zapisać prywatnie poza repo, a w docs tylko reguły i ograniczenia.

## M1: magazyn i przepływ

W trakcie: powstał syntetycznie testowany przepływ od jawnych decyzji i dowodów przez projekcję sześciu metryk, zapis rewizji, REST i widok dnia. Uwzględnia czas warszawski, kwalifikację kalorii, średnie zaakceptowanych pomiarów i deterministyczne uwagi. Osobne notatki użytkownika i ich historia zostały [wykonane](../completed/01-p0-probes.md). Schemat magazynu został zaktualizowany po wykonaniu kopii na wskazanym dysku, lecz rzeczywiste dane nie są jeszcze automatycznie kwalifikowane ani przeliczane; polityka źródeł i ocena danych wymagają walidacji.

Próbne nowe zadania odczytu masy i tkanki tłuszczowej wybierają dzień warszawski; starsze zadania zachowują zapisany zakres UTC. To nadal pojedynczy ręczny odczyt stron, nie synchronizacja ani potwierdzenie kompletności.

- [ ] Wdrożyć źródłowe wersje, obserwacje, tożsamość/repliki, definicje, projekcje dnia i ustrukturyzowane uwagi. Import ma preview, podsumowanie zakresu i checkpoint porcji. Zapis transakcyjny oraz idempotencja powtórzenia.
- [ ] Wdrożyć sześć typów MVP z [planu API](02-health-api.md) i [Takeout](03-import-migration.md); brak archiwalnego total/active zachować jako brak, nie odzyskiwać z obecnych ustawień BMR.
- [ ] Wprowadzić osobne: ręczny import historii, odświeżenie bieżących dni i przeliczenie lokalne po zmianie reguł. Przeliczenie nie wymaga ponownego pobrania wszystkich oryginałów. Kolejka z postępem i wznowieniem; anulowanie dalszej pracy nie jest rollbackiem.
- [ ] Pierwszy backfill od 2026-01-01 do końca ostatniej zakończonej doby. Dziś widoczny jako dzień częściowy, bez włączania do analiz pełnych dób. Domyślnie odświeżać ostatnie trzy zakończone dni i dzisiejszy odczyt; starsze zmiany przez mechanizm API albo okresową/ręczną rekonsyliację, bez obietnicy kompletności krótkiego okna.
- [ ] Scheduler działa w procesie serwera (wdrożone: odświeżanie dzisiejszej doby i trzech ostatnich zakończonych dób, wznowienie niedokończonych zadań, nadrobienie przerwy do 13 dni, zmienna `TRIVIMO_GOOGLE_SYNC_MINUTES`, przycisk „Odśwież teraz”; ponowienie pojedynczego żądania przy 429 według `Retry-After` albo rosnącego odstępu z rozrzutem, a po trwałym 429 wstrzymanie przebiegów do podanego czasu, tylko w pamięci procesu; do zrobienia: zaznaczenie dłuższej przerwy w tabeli dni, rekonsyliacja starszych dni oraz kolejka z anulowaniem; porządkowanie powtórzonych odczytów wdrożone według polityki w decyzjach). Pierwotne wymaganie:  Gdy komputer jest wyłączony, zaznacz przerwę i nadrób po uruchomieniu; nie obiecuj działania przeglądarki w tle. Harmonogram i automatyzację konfigurować osobno od samego otwarcia tabeli.

## M1: UI

Wykonano początkowy widok tabeli zapisanych wyników: zakres do 366 dni, filtr dni z automatycznymi uwagami, wybór metryk, sortowanie według daty i osobna kolumna notatek. Sortowanie według wartości zachowuje dokładność i umieszcza braki na końcu. Widok dnia pozwala zestawić kandydatów masy lub tkanki tłuszczowej z Takeout i zapisanych stron Google, bez rozstrzygania ich tożsamości; pokazuje także zakresy i stan zapisanych zadań Google, bez wnioskowania o kompletności źródła. Podstawowe szczegóły pokazują stan i rewizję; wirtualizacja oraz pełne pochodzenie i decyzje pozostają otwarte. Rzeczywiste dane nadal nie są automatycznie przeliczane.

- [ ] Lewa nawigacja/zakładki: Przegląd, Dane, Źródła/Importy, Ustawienia. Prosty ciemny motyw, czytelne jednostki, fokus i kontrast, brak docelowego redesignu na tym etapie.
- [ ] Tabela: data, sześć metryk, Uwagi; sortowanie, zakres dat, wybór kolumn, filtrowanie problemów i wirtualizacja przy dużych zakresach. Liczby pozostają liczbami. Puste pole ma rozróżnialny status w szczegółach/tooltipie; bez zera i bez nieczytelnych kodów we wszystkich komórkach.
- [ ] Kliknięcie komórki: definicja, źródło/urządzenie o ile znane, czas/zakres, jakość, oryginalna wartość, użyty wynik, wersja reguły i powód dyskwalifikacji. To miejsce także do porównania API/Takeout, bez przeładowywania podstawowej tabeli.
- [ ] Podstawowy przegląd: ostatnia znana masa i data pomiaru, kroki/dystans/kalorie wybranego dnia, wykresy trendów. Średnie podają liczbę poprawnych dni/pomiarów i luki; nie łącz linii przez brakujące dane bez oznaczenia. Nie sumuj procentu tłuszczu/masy.
- [x] Udział doby z opaską i podział aktywnych kalorii na okna z tętnem i bez w widoku dnia (`GET /api/google/band-share`, zadania „Tętno — okna 10 min" i „Kalorie aktywne — okna 10 min"); wdrożone też: kolumna „Udział opaski” w tabeli dni (`GET /api/google/band-share-range`, do 366 dni) i oznaczenie doby w toku w tabeli oraz w widoku dnia; do zrobienia: oznaczenie w toku także w snapshotach kanonicznych po ich podłączeniu do danych Google oraz automatyczny odczyt okien dla starszych zakresów (backfill od 2026-01-01).
- [x] Szczegółowe serie godzinowe kroków, dystansu, kalorii total i aktywnych w widoku dnia („Przebieg doby”, `GET /api/google/day-series`, z okien 10-minutowych `steps-10m`, `distance-10m`, `total-calories-10m`, `active-energy-10m`); suma godzin zgadza się z dziennym agregatem, a godzina bez okien to brak odczytu, nie zero. Poniższy opis wykresu został zrealizowany w tej postaci; do zrobienia: porównanie z kształtem wykresu w Health dla kroków i dystansu oraz seria tętna.
- [x] Wykres dobowy spalonych kalorii jak w aplikacji Health (słupki godzinowe; zgłoszone przez użytkownika 2026-11-03). API ma `dataPoints:rollUp` z oknem czasu (np. `3600s`, czas fizyczny UTC, dla `total-calories` do 14 dni, pole `startTime`/`endTime`, sprawdzono 2026-11-03), a Takeout minutowy plik `calories`; odczyt próbny 2026-11-03 potwierdził, że 24 godzinowe okna warszawskiej doby sumują się dokładnie do `dailyRollUp`, a maksimum godziny zgadza się ze słupkiem Health; do rozstrzygnięcia: pozostała odpowiedniość z słupkami Health, dzień warszawski a UTC i oznaczenie źródła (opaska/telefon, filtr `google-wearables`).
- [ ] Dzień producenta i dzień aplikacji opisane jawnie, jeśli się różnią. Wartości porównywane na wykresie muszą mieć tę samą definicję i kontrakt; zmiana modelu źródła widoczna jako przerwa/oznaczenie.
- [ ] Panel źródeł: ostatni udany odczyt, zakres danych, brakujące uprawnienia, zadania i błędy bez ujawniania sekretów. Eksport CSV wybranej projekcji opcjonalny po podstawowym UI, z zabezpieczeniem przed formułami i zachowaniem jednostek/statusów.

## Kryteria odbioru

- [ ] Powtórny import i odświeżenie nie zmieniają liczby oryginalnych pomiarów ani nie podwajają sum. API i Takeout nie dublują tej samej historii.
- [ ] Syntetyczne testy obejmują BMR-only, modele telefon/opaska, brak metadanych, dzień bez opaski, częściowy dzień, zero, różne jednostki, wiele ważeń, DST, błąd/paginację i restart.
- [ ] Wynik jest niezależny od porcji pojedynczy dzień/tydzień/miesiąc; sprawdzony także początek zakresu i ostatni interwał doby. Nie portować obejścia błędu agregacji Connect bez potwierdzenia potrzeby.
- [ ] Wartość i Uwagi mają jedną rewizję; powtórzenie nie dokleja tekstu, rozwiązanie problemu usuwa tylko jego aktywną uwagę. Prywatne notatki nie giną.
- [ ] Rzeczywisty ograniczony odczyt i import z tego samego zakresu porównany z UI Health, z uwzględnieniem opóźnienia synchronizacji i daty eksportu. Nierozstrzygnięte różnice widoczne; żadnej deklaracji „zgodne” na podstawie samego testu parsera.
- [ ] Kopia kompletnej bazy, przyszłych załączników i zadań odtworzona w pustym środowisku. Zamknięcie/przerwanie procesu nie niszczy ostatniego potwierdzonego wyniku. Odtworzenie istniejącego magazynu surowego [wykonano](../completed/01-p0-probes.md).

**TODO po M1:** audyt poprzednich lat, z osobną oceną modeli i zakresu eksportów, przed rozszerzeniem migracji. Nie wymuszać dzisiejszej definicji na nieznanej starszej historii.
