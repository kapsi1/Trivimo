# Plan realizacji i zależności

Semantyka: [kontrakty](../data-contracts.md). Wykonane: [docs/completed](../completed/).

| Etap | Wynik i zależności | Plan |
| --- | --- | --- |
| P0 | Stos, szkielet, migracje/testy, próby możliwości — **wykonane** | [P0](../completed/01-p0-probes.md) |
| M1 | Lokalne MVP: 6 metryk z API i Takeout, tabela/wykresy/uwagi, historia 2026 — **w końcowej fazie** | [01](01-foundation-mvp.md), [02](02-health-api.md), [03](03-import-migration.md) |
| M2 | Treningi, HR, strefy, mapy, dashboardy; pełny katalog API iteracyjnie | [02](02-health-api.md), [04](04-ui-workouts.md) |
| M3 | Dziennik posiłków, produkty/receptury, import obecnych danych i OFF | [05](05-nutrition.md), [06](06-food-sources.md) |
| M4 | Planer i import FatSecret; zależy od wpisów/produktów, nie od AI | [05](05-nutrition.md), [06](06-food-sources.md) |
| M5 | Wpisy przez ChatGPT na telefonie albo mobilne web UI, tekst/głos/zdjęcia | [07](07-ai-chatgpt.md) |
| M6 | Analizy AI treningów, potem żywienia | [07](07-ai-chatgpt.md) |
| M7 | Zapis wybranych typów do Health i opcjonalnie Connect | [08](08-sync-android.md) |
| M8 | Opcjonalny komponent Android, jeśli uzasadniony | [08](08-sync-android.md) |
| Q | Prywatność, testy, kopie i operacje — przekrojowo | [09](09-quality-operations.md) |

Etapy nie są harmonogramem. Pełny katalog API nie warunkuje tabeli, Android nie warunkuje importu. M5 może wyprzedzić M4; próbę ChatGPT mobilnego można zrobić wcześniej na syntetycznej komendzie.

## Stan M1 (2026-11-06)

Działa i jest sprawdzone (syntetycznie i na koncie użytkownika): autoryzacja Google z trwałym tokenem, magazyn v13, sześć metryk zakwalifikowanych z danych Google od 2026-01-01 (i na żądanie wcześniej), odświeżanie automatyczne z polityką odczytów, uzupełnianie historii, import Takeout (katalog i ZIP) i CSV, interfejs według [projektu UI](../design/ui.md), kopia i odtworzenie. Szczegóły: [M1 — wykonane](../completed/02-m1.md), [raport testów](../test-results.md).

Pozostałe punkty: [plan MVP](01-foundation-mvp.md) — najważniejsze to testy odbioru (powtórny import, niezależność od porcji, DST, paginacja), strefy czasowe, eksport CSV i kopia z UI. Porównanie z aplikacją Health jest wstrzymane decyzją użytkownika (2026-11-04).

Nierozstrzygnięte: nagłówek Health wyższy o ok. 0,55 % od API dla jednej doby; rola źródła „Phone Health Connect” ([obserwacje](../completed/03-data-findings.md)); zachowanie polityki odczytów po wielu przebiegach (starsze odczyty bez znacznika „automatyczny” nie są porządkowane); praca w tle po wielu godzinach i restarcie komputera.

## Bramy jakości

- [ ] M1: przepływ sześciu metryk dla importu i API, jedna semantyka historii i przyszłości, brak BMR-only i nieporównywalnego active w wynikach kanonicznych, widoczne luki, odtwarzalna kopia — pozostały kryteria odbioru z [planu MVP](01-foundation-mvp.md#kryteria-odbioru).
- [ ] Każdy kolejny typ: karta definicji, jednostki, czas, pochodzenie, operacje, brak/zero, testy syntetyczne i ograniczony rzeczywisty odczyt. „Wszystkie dane API” wymaga raportu pokrycia całego katalogu.
- [ ] M5: realny wpis z telefonu, potwierdzenie, korekta, ponowienie bez duplikatu, zachowanie przy niedostępnym hoście.
- [ ] M7: dowód per typ/operacja, timeout i restart, brak pętli, jawnie niewspierane cele; bez masowego czyszczenia Connect.

## Dane rzeczywiste w pracy deweloperskiej

Decyzja użytkownika z 2026-11-03: gdy potrzebna jest rzeczywista wartość, kształt odpowiedzi lub przypadek brzegowy, agent może czytać Google Health API (przez autoryzację aplikacji) i Takeout zamiast zgadywać. Założenia o formatach są tymczasowe i oznaczone jako niepotwierdzone.

- Takeout leży w `test-data/` (w `.gitignore`). Poza nim, bazą aplikacji i API nie szukaj danych zdrowotnych po dysku.
- Czytaj najmniejszy potrzebny zakres (kilka dni, jeden typ, jedna strona), tylko do odczytu.
- Wartości, ID rekordów, konta, tokeny i trasy nie trafiają do `docs/`, fixture'ów, logów ani commitów. W docs reguły i kształty, w testach przypadki syntetyczne, raport z wartościami poza repo.
- Odczyt rzeczywisty nie zastępuje walidacji użytkownika; zgodność z UI Health opisuje się z datą i ograniczeniami.

## Rozliczanie pracy

Przed zadaniem: mały pionowy zakres z kryteriami. Po wykonaniu: ukończone punkty do `docs/completed/`, wynik testów do [raportu](../test-results.md). Etap z otwartą próbą telefonu/konta jako kryterium nie jest ukończony. Bez terminów i estymacji; nieznana dostępność API, Gemini i mobilnego MCP ma zadania badawcze z możliwym wynikiem „niedostępne”.
