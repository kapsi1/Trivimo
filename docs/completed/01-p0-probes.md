# P0 — ukończone próby

## Pionowy przykład syntetyczny

SQLite w pamięci → repozytorium → REST → ciemna tabela i niewielki wykres. Widać wartość, brak, jawne zero oraz uwagę. Test HTTP i kontrola w przeglądarce są opisane w [raporcie](../test-results.md). Nie jest to połączenie z kontem ani trwały magazyn zdrowia.

## Próba parserów Kotlin

2026-11-02 uruchomiono wybrane pliki domenowe Health Sync na syntetycznym CSV: waga w gramach, osobne kolumny total i active, jawne zero, niepoprawna liczba i nieznane źródło. Stary akumulator dał także oczekiwany syntetyczny szacunek dnia dla dwóch punktów. Szczegóły uruchomienia są w [środowisku](../development.md).

- Do dalszego projektu nadają się zasady jawnego sprawdzania nagłówków, limitów, czasu, liczby i jednostek oraz oddzielne traktowanie total/active. Właściwy adapter musi zachować źródłową wartość i precyzję, a nie tylko wynik przeliczenia do `Double`.
- Dawny akumulator grupuje punkty minutami, priorytetyzuje kategorie i wyklucza kategorię Connect; sam nazywa wynik przybliżeniem. Mapowanie nazw konkretnych urządzeń i ten szacunek nie są definicją pochodzenia ani kanonicznego dnia Trivimo. Nie przenosimy ich automatycznie; szczególnie total/active nie kwalifikują się wyłącznie dlatego, że istnieje liczba.
- Parsery używają `java.io`, `java.time` i typów z domeny Kotlin, lecz przeniesienie ich do TypeScript nie jest mechanicznym wklejeniem. Próba nie wykazała potrzeby mostu JVM dla całej aplikacji; pozostaje wybrany stos TypeScript. Obsługa rzeczywistego eksportu i kalibracja polityki kalorii wymagają osobnej weryfikacji.
