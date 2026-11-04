# P0 / M1 — fundament i pierwsze sześć metryk

Cel: użyteczna tabela/wykresy dla 2026 i nowych dni, oparta na własnej bazie. Bez map, dziennika, AI i zapisów zewnętrznych jako warunku startu. [Kontrakty](../data-contracts.md) są obowiązujące; stos z [architektury](../architecture.md) jest propozycją.

Wykonane: próby P0 w [P0 — wykonane](../completed/01-p0-probes.md), a magazyn, sześć metryk z danych Google, odświeżanie, backfill, tabela, przegląd, kopia i odtworzenie w [M1 — wykonane](../completed/02-m1.md). Poniżej tylko to, co zostało.

## M1: magazyn i przepływ

- [ ] Rekonsyliacja starszych dni: późne korekty producenta poza oknem trzech ostatnich zakończonych dób (okresowy albo ręczny ponowny odczyt, bez obietnicy kompletności krótkiego okna).
- [ ] Praca w tle sprawdzona po kilku godzinach działania serwera i po restarcie komputera; zachowanie polityki odczytów na prawdziwych danych po wielu przebiegach. Nie obiecywać działania przeglądarki w tle.

## M1: UI

- [ ] Lewa nawigacja/zakładki: Przegląd, Dane, Źródła/Importy, Ustawienia (dziś prowizoryczne zakładki, w tym „Przykład”). Prosty ciemny motyw, czytelne jednostki, fokus i kontrast, brak docelowego redesignu na tym etapie.
- [ ] Tabela: wirtualizacja przy dużych zakresach.
- [ ] Kliknięcie komórki: oryginalna wartość źródła, czas/zakres odczytu i porównanie API/Takeout, bez przeładowywania podstawowej tabeli (definicja, reguła, stan, użyty wynik i powód są już pokazywane).
- [ ] Panel źródeł: ostatni udany odczyt, zakres danych, brakujące uprawnienia, zadania i błędy bez ujawniania sekretów (dziś rozproszone w panelach Google). Eksport CSV wybranej projekcji opcjonalny po podstawowym UI, z zabezpieczeniem przed formułami i zachowaniem jednostek/statusów.
- [ ] Seria godzinowa tętna w widoku dnia. (Porównanie kształtu wykresów kroków i dystansu z Health pominięte na razie, jak porównanie z UI Health w kryteriach odbioru.)
- [ ] Widok na wąskim ekranie telefonu.

## Kryteria odbioru

- [ ] Powtórny import i odświeżenie nie zmieniają liczby oryginalnych pomiarów ani nie podwajają sum. API i Takeout nie dublują tej samej historii (dziś zapewnione regułami i polityką odczytów, bez testu całego przepływu).
- [ ] Syntetyczne testy obejmują BMR-only, modele telefon/opaska, brak metadanych, dzień bez opaski, częściowy dzień, zero, różne jednostki, wiele ważeń, DST, błąd/paginację i restart (brakują m.in. DST dla wszystkich metryk, wielostronicowych list i restartu w trakcie odczytu).
- [ ] Wynik jest niezależny od porcji pojedynczy dzień/tydzień/miesiąc; sprawdzony także początek zakresu i ostatni interwał doby. Nie portować obejścia błędu agregacji Connect bez potwierdzenia potrzeby.
- [ ] **Pominięte na razie (decyzja użytkownika 2026-11-04; wykonywać tylko na wyraźną prośbę):** rzeczywisty ograniczony odczyt i import z tego samego zakresu porównany z UI Health, z uwzględnieniem opóźnienia synchronizacji i daty eksportu. Nierozstrzygnięte różnice widoczne; żadnej deklaracji „zgodne” na podstawie samego testu parsera. Dopóki nie wykonano, M1 nie jest deklarowane jako zgodne z aplikacją Health.

**TODO po M1:** audyt poprzednich lat, z osobną oceną modeli i zakresu eksportów, przed rozszerzeniem migracji. Nie wymuszać dzisiejszej definicji na nieznanej starszej historii.
