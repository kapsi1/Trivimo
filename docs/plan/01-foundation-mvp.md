# P0 / M1 — fundament i pierwsze sześć metryk

Cel: użyteczna tabela/wykresy dla 2026 i nowych dni, oparta na własnej bazie. Bez map, dziennika, AI i zapisów zewnętrznych jako warunku startu. [Kontrakty](../data-contracts.md) są obowiązujące; stos z [architektury](../architecture.md) jest propozycją.

## P0: przygotowanie i małe próby

Wykonane próby syntetycznego przepływu i parserów opisuje [P0 — wykonane](../completed/01-p0-probes.md). Pozostają m.in. trwała baza aplikacji i kopia przed przyszłymi migracjami; szczegóły i ograniczenia są w [raporcie](../test-results.md).

- [ ] Potwierdzić stos, sposób uruchomienia na Windows, manager pakietów, wspólne schematy walidacji, migracje DB i runner testów. Dodać README z rzeczywistymi poleceniami, lockfile i minimalne CI dopiero po utworzeniu kodu. Brak frameworka pełnej synchronizacji na zapas.
- [ ] W autoryzowanym etapie integracji skonfigurować osobnego klienta OAuth i próbę read-only kilku dni: rekordy waga/tłuszcz, kroki/dystans, total/active, pochodzenie. Sprawdzić `Operation`/metody tylko w dokumentacji; nie testować zapisu w tym etapie.
- [ ] Ustalić politykę kalorii na małej próbce: dzień z noszeniem, bez noszenia, niepełny, BMR-only i potwierdzone zero, jeśli występują. Oddzielić brak metadanych od braku pomiarów. Jeśli brak dowodu porównywalności, zachować lukę i opisać kryterium; nie wymyślać kwalifikatora dla pełności tabeli.
- [ ] Porównać API/Takeout dla tego samego konta, zakończonych dat, strefy, jednostek i wersji. Wynik próby zapisać prywatnie poza repo, a w docs tylko reguły i ograniczenia.

## M1: magazyn i przepływ

- [ ] Wdrożyć źródłowe wersje, obserwacje, tożsamość/repliki, definicje, projekcje dnia i ustrukturyzowane uwagi. Import ma preview, podsumowanie zakresu i checkpoint porcji. Zapis transakcyjny oraz idempotencja powtórzenia.
- [ ] Wdrożyć sześć typów MVP z [planu API](02-health-api.md) i [Takeout](03-import-migration.md); brak archiwalnego total/active zachować jako brak, nie odzyskiwać z obecnych ustawień BMR.
- [ ] Wprowadzić osobne: ręczny import historii, odświeżenie bieżących dni i przeliczenie lokalne po zmianie reguł. Przeliczenie nie wymaga ponownego pobrania wszystkich oryginałów. Kolejka z postępem i wznowieniem; anulowanie dalszej pracy nie jest rollbackiem.
- [ ] Pierwszy backfill od 2026-01-01 do końca ostatniej zakończonej doby. Dziś widoczny jako dzień częściowy, bez włączania do analiz pełnych dób. Domyślnie odświeżać ostatnie trzy zakończone dni i dzisiejszy odczyt; starsze zmiany przez mechanizm API albo okresową/ręczną rekonsyliację, bez obietnicy kompletności krótkiego okna.
- [ ] Scheduler działa w procesie serwera. Gdy komputer jest wyłączony, zaznacz przerwę i nadrób po uruchomieniu; nie obiecuj działania przeglądarki w tle. Harmonogram i automatyzację konfigurować osobno od samego otwarcia tabeli.

## M1: UI

- [ ] Lewa nawigacja/zakładki: Przegląd, Dane, Źródła/Importy, Ustawienia. Prosty ciemny motyw, czytelne jednostki, fokus i kontrast, brak docelowego redesignu na tym etapie.
- [ ] Tabela: data, sześć metryk, Uwagi; sortowanie, zakres dat, wybór kolumn, filtrowanie problemów i wirtualizacja przy dużych zakresach. Liczby pozostają liczbami. Puste pole ma rozróżnialny status w szczegółach/tooltipie; bez zera i bez nieczytelnych kodów we wszystkich komórkach.
- [ ] Kliknięcie komórki: definicja, źródło/urządzenie o ile znane, czas/zakres, jakość, oryginalna wartość, użyty wynik, wersja reguły i powód dyskwalifikacji. To miejsce także do porównania API/Takeout, bez przeładowywania podstawowej tabeli.
- [ ] Podstawowy przegląd: ostatnia znana masa i data pomiaru, kroki/dystans/kalorie wybranego dnia, wykresy trendów. Średnie podają liczbę poprawnych dni/pomiarów i luki; nie łącz linii przez brakujące dane bez oznaczenia. Nie sumuj procentu tłuszczu/masy.
- [ ] Dzień producenta i dzień aplikacji opisane jawnie, jeśli się różnią. Wartości porównywane na wykresie muszą mieć tę samą definicję i kontrakt; zmiana modelu źródła widoczna jako przerwa/oznaczenie.
- [ ] Panel źródeł: ostatni udany odczyt, zakres danych, brakujące uprawnienia, zadania i błędy bez ujawniania sekretów. Eksport CSV wybranej projekcji opcjonalny po podstawowym UI, z zabezpieczeniem przed formułami i zachowaniem jednostek/statusów.

## Kryteria odbioru

- [ ] Powtórny import i odświeżenie nie zmieniają liczby oryginalnych pomiarów ani nie podwajają sum. API i Takeout nie dublują tej samej historii.
- [ ] Syntetyczne testy obejmują BMR-only, modele telefon/opaska, brak metadanych, dzień bez opaski, częściowy dzień, zero, różne jednostki, wiele ważeń, DST, błąd/paginację i restart.
- [ ] Wynik jest niezależny od porcji pojedynczy dzień/tydzień/miesiąc; sprawdzony także początek zakresu i ostatni interwał doby. Nie portować obejścia błędu agregacji Connect bez potwierdzenia potrzeby.
- [ ] Wartość i Uwagi mają jedną rewizję; powtórzenie nie dokleja tekstu, rozwiązanie problemu usuwa tylko jego aktywną uwagę. Prywatne notatki nie giną.
- [ ] Rzeczywisty ograniczony odczyt i import z tego samego zakresu porównany z UI Health, z uwzględnieniem opóźnienia synchronizacji i daty eksportu. Nierozstrzygnięte różnice widoczne; żadnej deklaracji „zgodne” na podstawie samego testu parsera.
- [ ] Kopia bazy i plików odtworzona w pustym środowisku. Zamknięcie/przerwanie procesu nie niszczy ostatniego potwierdzonego wyniku.

**TODO po M1:** audyt poprzednich lat, z osobną oceną modeli i zakresu eksportów, przed rozszerzeniem migracji. Nie wymuszać dzisiejszej definicji na nieznanej starszej historii.
