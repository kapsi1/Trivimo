# Plan realizacji i zależności

P0 rozpoczęto od syntetycznego przykładu; w M1 rozpoczęto lokalny import surowych plików Takeout, bez dziennych wyników i odczytu API. Plan przygotowany 2026-11-02; szczegóły semantyki mają jedno miejsce w [kontraktach](../data-contracts.md).

| Etap | Wynik i zależności | Plan |
| --- | --- | --- |
| P0 | Ustalenie stosu, minimalny szkielet, migracje/testy i próby możliwości; bez zależności od nazwy/żywienia | [01](01-foundation-mvp.md) |
| M1 | Użyteczne lokalne MVP: 6 metryk, Takeout + odczyt API, tabela/wykresy/uwagi, poprawna historia 2026 | [01](01-foundation-mvp.md), [02](02-health-api.md), [03](03-import-migration.md) |
| M2 | Treningi, HR, strefy, mapy, więcej dashboardów; pełny katalog API rozwijany iteracyjnie po M1 | [02](02-health-api.md), [04](04-ui-workouts.md) |
| M3 | Ręczny dziennik posiłków, produkty/receptury, własny katalog; import obecnych danych i OFF | [05](05-nutrition.md), [06](06-food-sources.md) |
| M4 | Planer i import FatSecret; zależy od stabilnych wpisów/produktów, nie od AI | [05](05-nutrition.md), [06](06-food-sources.md) |
| M5 | Wygodne wpisy przez ChatGPT na telefonie albo mobilne web UI, tekst/głos/zdjęcia, kontrolowane AI | [07](07-ai-chatgpt.md) |
| M6 | Analizy AI treningów i później żywienia; pierwsza analiza treningu może nastąpić po M2 | [07](07-ai-chatgpt.md) |
| M7 | Zapis wybranych typów do Health i opcjonalnie Connect, weryfikacja i konflikty | [08](08-sync-android.md) |
| M8 | Opcjonalny komponent/klient Android; wcześniej tylko jeśli uzasadni go brak danych lub potrzebny zapis Connect | [08](08-sync-android.md) |
| Q | Prywatność, testy, backup/restore i operacje — wymagania od P0, nie końcowy dodatek | [09](09-quality-operations.md) |

Etapy nie są sztywnym harmonogramem. Nie buduj całego katalogu API jako warunku pierwszej tabeli ani pełnego Androida jako warunku importu Takeout. M5 może wyprzedzić M4, gdy działa dziennik i jego komendy. Próba ChatGPT mobilnego może być wykonana wcześniej na syntetycznej komendzie, żeby rozstrzygnąć architekturę dostępu.

## Bramy jakości

- [ ] P0: działający szkielet i syntetyczny pionowy przepływ baza→REST→tabela, narzędzia weryfikacji oraz zapisane decyzje. Próby z kontem tylko w zleconym zakresie.
- [ ] M1: przepływ sześciu metryk dla importu i API, jedna semantyka historii/przyszłości, brak BMR-only/nieporównywalnego active w kanonicznych wynikach, widoczne luki, odtwarzalna kopia. Brak OAuth pozostaje jawną luką, nie „ukończonym API”.
- [ ] Każdy kolejny typ: karta definicji, jednostki, czas, pochodzenie, operacje, brak/zero, syntetyczne testy i ograniczony rzeczywisty odczyt. „Wszystkie dane API” wymaga raportu pokrycia całego aktualnego katalogu, nie tylko listy obiecanych ekranów.
- [ ] M5: realny wpis z telefonu w wybranym wariancie, odczyt potwierdzenia, korekta, ponowienie bez duplikatu i zachowanie po niedostępności hosta. Nie wymaga własnej aplikacji Android.
- [ ] M7: dowód per typ/operacja, wybrany własny rekord, timeout i restart, brak pętli, jawne niewspierane cele; żadnego masowego czyszczenia Connect.

## Zasada rozliczania pracy

Przed implementacją zadania agent wybiera mały pionowy zakres i podaje kryteria. Po wykonaniu usuwa ukończone checkboxy z planu do `docs/completed/` oraz zapisuje wynik bieżących testów. Nie oznacza całego etapu jako niewykonanego wyłącznie przez pojedynczą pozostałą próbę telefonu; nie oznacza jako ukończonego bez tej próby, jeśli jest kryterium etapu.

Nie ma tu terminów i estymacji kosztu budowy. Nieznana dostępność API, podsumowań Gemini i mobilnego MCP ma osobne zadania badawcze z wynikiem także „niedostępne”.
