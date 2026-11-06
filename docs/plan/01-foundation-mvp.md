# P0 / M1 — fundament i pierwsze sześć metryk

Cel: użyteczna tabela i wykresy dla 2026 i nowych dni z własnej bazy, bez map, dziennika, AI i zapisów zewnętrznych. Wykonane: [P0](../completed/01-p0-probes.md), [M1](../completed/02-m1.md). Poniżej tylko to, co zostało.

## M1: magazyn i przepływ

- [ ] Rekonsyliacja starszych dni: późne korekty producenta poza oknem trzech ostatnich zakończonych dób (okresowy albo ręczny ponowny odczyt, bez obietnicy kompletności krótkiego okna).
- [ ] Praca w tle sprawdzona po kilku godzinach działania serwera i po restarcie komputera; zachowanie polityki odczytów na prawdziwych danych po wielu przebiegach. Nie obiecywać działania przeglądarki w tle.

## M1: UI

Obecny interfejs: [projekt UI](../design/ui.md). Zostało:

- [ ] Tabela: wirtualizacja przy dużych zakresach (zakres do „Od początku”, wiele lat; dziś bez wirtualizacji).
- [ ] Prognoza spalonych kalorii (`prognoza-spoczynek-v0`): reguła wyboru okien wdrożona w najprostszej postaci (wszystkie dzisiejsze okna bez kroków i aktywnych kcal, co najmniej 6). Ocenić na kilku dobach, czy okna nocne lub dłuższe okno odniesienia dają lepszą stawkę; zmiana metody to nowa wersja reguły.
- [ ] Eksport CSV wybranej projekcji (przycisk nieaktywny), z zabezpieczeniem przed formułami i zachowaniem jednostek/statusów.
- [ ] Kopia zapasowa z interfejsu (Ustawienia pokazują polecenia CLI) oraz historia importów i dziennik zdarzeń w „Źródłach danych” — wymagają nowych punktów API.
- [ ] Widok telefonu sprawdzony tylko w emulacji 375 px w przeglądarce aplikacji; na telefonie nie sprawdzano.

## Kryteria odbioru

- [ ] Powtórny import i odświeżenie nie zmieniają liczby oryginalnych pomiarów ani nie podwajają sum. API i Takeout nie dublują tej samej historii (dziś zapewnione regułami i polityką odczytów, bez testu całego przepływu).
- [ ] Syntetyczne testy obejmują BMR-only, modele telefon/opaska, brak metadanych, dzień bez opaski, częściowy dzień, zero, różne jednostki, wiele ważeń, DST, błąd/paginację i restart (brakują m.in. DST dla wszystkich metryk, wielostronicowych list i restartu w trakcie odczytu).
- [ ] Wynik jest niezależny od porcji pojedynczy dzień/tydzień/miesiąc; sprawdzony także początek zakresu i ostatni interwał doby. Nie portować obejścia błędu agregacji Connect bez potwierdzenia potrzeby.

**TODO po M1:** audyt poprzednich lat, z osobną oceną modeli i zakresu eksportów, przed rozszerzeniem migracji. Nie wymuszać dzisiejszej definicji na nieznanej starszej historii.
