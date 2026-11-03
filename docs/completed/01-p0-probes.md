# P0 — ukończone próby

## Fundament i brama syntetyczna

- [x] Wybrano TypeScript, React/Vite, Node 24, SQLite, npm i test runner Node; dodano wspólne schematy Zod, początkowe wersjonowanie bazy, lockfile, komendy dla Windows i konfigurację CI. Próba migracji następnej wersji i kopii przed zmianą jest syntetyczna; nie oznacza wdrożenia projekcji do prywatnej bazy.
- [x] Szkielet i syntetyczny przepływ baza → REST → tabela działają; istnieją narzędzia weryfikacji i zapisane decyzje. Pozostałe próby P0 zależne od konta oraz walidacja polityki kalorii pozostają w planie.

## Wskazanie katalogu importu

- [x] Użytkownik wskazuje katalog eksportu; importer nie wyszukuje prywatnych archiwów po dysku. Import testowano także na syntetycznych plikach; prywatnych danych Health Sync nie kopiowano do repozytorium. Obsługa wskazanego, rozpakowanego katalogu nie oznacza ukończenia obsługi ZIP.

## Odtworzenie istniejącego magazynu surowego

- [x] Kopię aktualnego magazynu oryginalnych plików odtworzono do pustego katalogu tymczasowego, porównano pełne skróty i sprawdzono integralność oraz odczyt; tymczasowy plik usunięto. Nie potwierdza to odtwarzania przyszłych załączników, korekt i zadań, które nie są jeszcze zaimplementowane.

## Niezależne notatki dnia

- [x] Notatka użytkownika ma oddzielną wersjonowaną historię i nie jest nadpisywana przeliczeniem automatycznych uwag. Syntetyczne testy obejmują konflikt zmian, odczyt, zapis i zachowanie przy ponownym przeliczeniu; w przeglądarce sprawdzono zapis, ponowny odczyt i ochronę niezapisanej treści. Szerszy odbiór kompletnej projekcji M1 pozostaje otwarty.

## Pionowy przykład syntetyczny

SQLite w pamięci → repozytorium → REST → ciemna tabela i niewielki wykres. Widać wartość, brak, jawne zero oraz uwagę. Test HTTP i kontrola w przeglądarce są opisane w [raporcie](../test-results.md). Nie jest to połączenie z kontem ani trwały magazyn zdrowia.

## Próba parserów Kotlin

2026-11-02 uruchomiono wybrane pliki domenowe Health Sync na syntetycznym CSV: waga w gramach, osobne kolumny total i active, jawne zero, niepoprawna liczba i nieznane źródło. Stary akumulator dał także oczekiwany syntetyczny szacunek dnia dla dwóch punktów. Szczegóły uruchomienia są w [środowisku](../development.md).

- Do dalszego projektu nadają się zasady jawnego sprawdzania nagłówków, limitów, czasu, liczby i jednostek oraz oddzielne traktowanie total/active. Właściwy adapter musi zachować źródłową wartość i precyzję, a nie tylko wynik przeliczenia do `Double`.
- Dawny akumulator grupuje punkty minutami, priorytetyzuje kategorie i wyklucza kategorię Connect; sam nazywa wynik przybliżeniem. Mapowanie nazw konkretnych urządzeń i ten szacunek nie są definicją pochodzenia ani kanonicznego dnia Trivimo. Nie przenosimy ich automatycznie; szczególnie total/active nie kwalifikują się wyłącznie dlatego, że istnieje liczba.
- Parsery używają `java.io`, `java.time` i typów z domeny Kotlin, lecz przeniesienie ich do TypeScript nie jest mechanicznym wklejeniem. Próba nie wykazała potrzeby mostu JVM dla całej aplikacji; pozostaje wybrany stos TypeScript. Obsługa rzeczywistego eksportu i kalibracja polityki kalorii wymagają osobnej weryfikacji.
