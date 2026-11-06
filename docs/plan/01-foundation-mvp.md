# P0 / M1 — fundament i pierwsze sześć metryk

Cel: użyteczna tabela/wykresy dla 2026 i nowych dni, oparta na własnej bazie. Bez map, dziennika, AI i zapisów zewnętrznych jako warunku startu. [Kontrakty](../data-contracts.md) są obowiązujące; stos z [architektury](../architecture.md) jest propozycją.

Wykonane: próby P0 w [P0 — wykonane](../completed/01-p0-probes.md), a magazyn, sześć metryk z danych Google, odświeżanie, backfill, tabela, przegląd, kopia i odtworzenie w [M1 — wykonane](../completed/02-m1.md). Poniżej tylko to, co zostało.

## M1: magazyn i przepływ

- [ ] Rekonsyliacja starszych dni: późne korekty producenta poza oknem trzech ostatnich zakończonych dób (okresowy albo ręczny ponowny odczyt, bez obietnicy kompletności krótkiego okna).
- [ ] Praca w tle sprawdzona po kilku godzinach działania serwera i po restarcie komputera; zachowanie polityki odczytów na prawdziwych danych po wielu przebiegach. Nie obiecywać działania przeglądarki w tle.

## M1: UI

Układ z [projektu UI](../design/ui.md) jest wdrożony (2026-11-04, zob. [M1 — wykonane](../completed/02-m1.md#ui)). Zostało:

- [ ] Tabela: wirtualizacja przy dużych zakresach (rok to dziś ok. 420 wierszy z tygodniami, bez wirtualizacji).
- [ ] Panel szczegółów: porównanie sum dobowych (kroki, dystans, kalorie) z Takeout. Dla masy i tkanki tłuszczowej panel pokazuje pomiary Takeout tej doby; dla sum nie ma jeszcze wyliczenia doby z wierszy eksportu.
- [ ] Prognoza spalonych kalorii (`prognoza-spoczynek-v0`): reguła wyboru okien wdrożona w najprostszej postaci (wszystkie dzisiejsze okna bez kroków i aktywnych kcal, co najmniej 6). Ocenić na kilku dobach, czy okna nocne lub dłuższe okno odniesienia dają lepszą stawkę; zmiana metody to nowa wersja reguły.
- [ ] Eksport CSV wybranej projekcji (przycisk nieaktywny), z zabezpieczeniem przed formułami i zachowaniem jednostek/statusów.
- [ ] Kopia zapasowa z interfejsu (Ustawienia pokazują polecenia CLI) oraz historia importów i dziennik zdarzeń w „Źródłach danych” — wymagają nowych punktów API.
- [ ] Strefy czasowe: dziś doba, tydzień i zmiana czasu są liczone wyłącznie w `Europe/Warsaw`. Dodać strefę jako ustawienie użytkownika (domyślnie Warszawa), a granice doby, okna 10-minutowe, „dziś”, prognozę i etykiety godzin liczyć w wybranej strefie. Zmiana znaczenia doby wymaga wersji reguły i migracji (zasada z `data-contracts.md`): wyniki dobowe zapisane dla poprzedniej strefy nie mogą się po cichu przesunąć, a przeliczenie ma być jawną operacją z zachowaniem oryginałów i historii. Do rozstrzygnięcia: jedna strefa globalna, czy strefa przypisana do doby (podróże: doba zapisana tam, gdzie była mierzona; Google zapisuje czas cywilny pomiaru). Testy: strefy bez i z DST oraz o innych przesunięciach (np. UTC, Nowy Jork, Kolkata o +5:30), doba 23/25 godzin w obu półkulach, granica doby przy zmianie strefy w trakcie podróży, niezależność wyniku od porcji importu.
- [ ] Teksty o strefie w interfejsie i dokumentacji: zastąpić sformułowania „doba warszawska”, „dzień warszawski”, „doby warszawskiej”, „w Warszawie”, „Data w Warszawie” i „Europe/Warsaw” (interfejs: Źródła danych, Tabela dni, Import CSV, Ustawienia; dokumentacja: `data-contracts.md`, `decisions.md`, `architecture.md`, `development.md`, `test-results.md`) neutralnym określeniem „doba” razem ze strefą wybraną w ustawieniach (np. „doba w strefie Europe/Warsaw” tylko tam, gdzie strefa jest istotna). Wykonać razem z obsługą stref: przed nią tekst „doba” bez strefy byłby mylący dla jedynej obsługiwanej strefy. Wpisy historyczne w `test-results.md` i `decisions.md` zachować z datą; poprawiać tylko opisy obowiązujących reguł i teksty widoczne dla użytkownika.
- [ ] Widok telefonu sprawdzony tylko w emulacji 375 px w przeglądarce aplikacji; na telefonie nie sprawdzano. (Porównanie kształtu wykresów kroków i dystansu z Health pominięte na razie, jak porównanie z UI Health w kryteriach odbioru.)

## Kryteria odbioru

- [ ] Powtórny import i odświeżenie nie zmieniają liczby oryginalnych pomiarów ani nie podwajają sum. API i Takeout nie dublują tej samej historii (dziś zapewnione regułami i polityką odczytów, bez testu całego przepływu).
- [ ] Syntetyczne testy obejmują BMR-only, modele telefon/opaska, brak metadanych, dzień bez opaski, częściowy dzień, zero, różne jednostki, wiele ważeń, DST, błąd/paginację i restart (brakują m.in. DST dla wszystkich metryk, wielostronicowych list i restartu w trakcie odczytu).
- [ ] Wynik jest niezależny od porcji pojedynczy dzień/tydzień/miesiąc; sprawdzony także początek zakresu i ostatni interwał doby. Nie portować obejścia błędu agregacji Connect bez potwierdzenia potrzeby.
- [ ] **Pominięte na razie (decyzja użytkownika 2026-11-04; wykonywać tylko na wyraźną prośbę):** rzeczywisty ograniczony odczyt i import z tego samego zakresu porównany z UI Health, z uwzględnieniem opóźnienia synchronizacji i daty eksportu. Nierozstrzygnięte różnice widoczne; żadnej deklaracji „zgodne” na podstawie samego testu parsera. Dopóki nie wykonano, M1 nie jest deklarowane jako zgodne z aplikacją Health.

**TODO po M1:** audyt poprzednich lat, z osobną oceną modeli i zakresu eksportów, przed rozszerzeniem migracji. Nie wymuszać dzisiejszej definicji na nieznanej starszej historii.
