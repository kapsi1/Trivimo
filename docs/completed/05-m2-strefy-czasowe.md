# M2 — strefy czasowe (wykonane 2026-11-06)

Zlecenie: zadanie „Strefy czasowe” z [planu Health API](../plan/02-health-api.md#strefy-czasowe). Model: jedna strefa globalna (wybór użytkownika 2026-11-06); strefa przypisana do doby została w planie.

## Zakres wykonany

- Reguła `day-zone-v1` ([kontrakty](../data-contracts.md#strefa-doby-day-zone-v1)): moduł domenowy `packages/domain/day-zone.ts` (granice doby `[start, end)`, przypisanie chwili do doby, minuty zegara ściennego, walidacja nazw IANA; północ nieistniejąca lub powtórzona nie psuje granic), zastępuje stałą `Europe/Warsaw` w kodzie domenowym, magazynie, serwerze i interfejsie.
- Magazyn v14: tabela `day_zone_versions` (wersja 1 = Europe/Warsaw), migracja z kopią (`migrateDayZone`), weryfikacja przy `verify:takeout`. Snapshot zapisuje `zone`; brak pola to Europe/Warsaw.
- Serwer: `DayZoneService` (zmiana strefy = nowa wersja ustawienia + przeliczenie dób z oryginałów jako nowych rewizji, odmowa podczas odświeżania, wznowienie przerwanego przeliczenia tym samym żądaniem), `GET`/`POST /api/settings/day-zone`. Planowanie odczytów, pokrycie, rekonsyliacja, polityka odczytów, prognoza i projekcja dób czytają strefę z magazynu; klucz pamięci podręcznej pokrycia zawiera strefę.
- Interfejs: Ustawienia → „Strefa doby” (lista stref, potwierdzenie z opisem skutków, „Dokończ przeliczanie”), strefa wczytywana przed pierwszym renderem, „dziś”, godziny i daty odczytów w wybranej strefie; teksty „doba warszawska” zastąpione „doba (w strefie z ustawień)”.
- Dokumentacja: kontrakty, architektura, środowisko (REST, wersja magazynu), decyzje, projekt UI.

## Weryfikacja

Raport: [wpis 2026-11-06 — strefy czasowe](../test-results.md). Testy: `tests/day-zone.test.ts` (UTC, Kolkata +5:30, Nowy Jork, Sydney, Auckland, Kuba z północą w przejściu DST, doby 23/25 h, ciągłość granic przez cały rok), `tests/source-day.test.ts`, `tests/day-zone-store.test.ts` (migracja, zmiana strefy z historią rewizji i powrotem, snapshoty sprzed v14, planowanie odczytów i niezależność pokrycia od porcji przy dobie 23 h, REST).

## Poza zakresem (zostało w planie)

Strefa przypisana do doby (podróże), przeliczenie wartości CSV i zasady dla notatek dnia po zmianie strefy, ręczna weryfikacja na koncie użytkownika, strefy z przesunięciem niepodzielnym przez 10 minut.
