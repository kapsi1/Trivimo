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

Syntetyczna brama P0 została wykonana i opisana w [ukończonych próbach](../completed/01-p0-probes.md); zadania zależne od konta i walidacji danych nadal pozostają otwarte.

- [ ] M1: przepływ sześciu metryk dla importu i API, jedna semantyka historii/przyszłości, brak BMR-only/nieporównywalnego active w kanonicznych wynikach, widoczne luki, odtwarzalna kopia. Brak OAuth pozostaje jawną luką, nie „ukończonym API”.
- [ ] Każdy kolejny typ: karta definicji, jednostki, czas, pochodzenie, operacje, brak/zero, syntetyczne testy i ograniczony rzeczywisty odczyt. „Wszystkie dane API” wymaga raportu pokrycia całego aktualnego katalogu, nie tylko listy obiecanych ekranów.
- [ ] M5: realny wpis z telefonu w wybranym wariancie, odczyt potwierdzenia, korekta, ponowienie bez duplikatu i zachowanie po niedostępności hosta. Nie wymaga własnej aplikacji Android.
- [ ] M7: dowód per typ/operacja, wybrany własny rekord, timeout i restart, brak pętli, jawne niewspierane cele; żadnego masowego czyszczenia Connect.

## Stan M1 i następne kroki

Stan na 2026-11-03 (szczegóły i dowody: [wyniki testów](../test-results.md), reguły: [kontrakty](../data-contracts.md), decyzje: [rejestr](../decisions.md)). Zrobione i sprawdzone (syntetycznie oraz na koncie użytkownika, bez przeglądarki): autoryzacja Google z trwałym tokenem, magazyn w wersji 9, odczyty sum dobowych i okien 10-minutowych (kroki, dystans, kalorie total i aktywne, tętno), odświeżanie automatyczne z polityką odczytów, widok dnia (kandydaci, udział opaski, przebieg doby) i kolumna udziału opaski w tabeli dni. Nie zrobione: kwalifikacja i snapshoty kanoniczne z danych Google, wartości w głównych komórkach tabeli dni.

Następne kroki w tej kolejności:

1. Backfill od 2026-01-01: kod wykonano 2026-11-03 (paczki 13 dób dla okien, 14 dla total, 90 dla pozostałych sum; postęp z pokrycia dób w bazie, zatrzymanie i wznowienie, panel „Uzupełnianie historii”). Pozostaje pierwszy przebieg na koncie użytkownika i sprawdzenie widoku w przeglądarce.
2. Kolejka z anulowaniem i zaznaczenie dłuższej przerwy w tabeli dni. Ponowienia przy 429 (`Retry-After` albo rosnący odstęp z rozrzutem) i wstrzymanie przebiegów po trwałym 429 wykonano 2026-11-03; rodzina źródeł `all-sources` jest jedną stałą w adapterach (zob. kontrakty).
3. Kwalifikacja kalorii i podłączenie snapshotów do danych Google z użyciem udziału opaski (zamiast progu doby; zob. decyzje o telefonie bez opaski) oraz rozstrzygnięcie roli źródła „Phone Health Connect” w aktywnej energii.
4. Seria godzinowa tętna, porównanie wykresów kroków i dystansu z Health, API vs Takeout dla kolejnych dób.

Otwarte pytania i niewyjaśnione rozbieżności: nagłówek Health dla jednej doby wyższy o ok. 0,55 % niż API; suma minutowego pliku Takeout `calories` niższa o ok. 0,2 % dla jednej doby bez opaski; zachowanie polityki odczytów na prawdziwych danych po kilku przebiegach (wcześniejsze odczyty bez znacznika „automatyczny” nie są porządkowane); praca w tle po kilku godzinach i po restarcie komputera oraz widoki w przeglądarce nie były sprawdzone. Zasady pracy użytkownika: git zarządzany ręcznie (nie twórz branchy, commitów ani PR; zapisane w pamięci agenta), odczyt rzeczywistych danych dozwolony (sekcja niżej).

## Dane rzeczywiste w pracy deweloperskiej

Decyzja użytkownika z 2026-11-03: gdy do dalszej pracy potrzebna jest rzeczywista wartość, kształt odpowiedzi lub przypadek brzegowy, agent może odczytać wartości z Google Health API (przez własną autoryzację aplikacji) oraz z Takeout, zamiast je zgadywać. Przypuszczenia o formatach i znaczeniu pól wolno przyjmować tylko tymczasowo i trzeba je oznaczyć jako niepotwierdzone.

- Eksport Takeout do pracy leży w katalogu `test-data/` w repozytorium; jest w `.gitignore` i nie trafia do gita. Poza nim, poza bazą aplikacji i API nie szukaj danych zdrowotnych po dysku.
- Czytaj najmniejszy zakres potrzebny do rozstrzygnięcia pytania (kilka dni, jeden typ, jedna strona); nie przeglądaj całych archiwów bez potrzeby. Odczyt jest tylko do odczytu: nic nie jest zapisywane do dostawcy ani nie zmienia danych.
- Wartości, rekordowe ID, konta, tokeny i trasy nie trafiają do `docs/`, fixture'ów testów, logów ani commitów. W dokumentacji zapisuj reguły, kształty i ograniczenia, a w testach przypadki syntetyczne odtwarzające znaleziony kształt. Raport z wartościami zapisuj poza repo.
- Odczyt rzeczywisty nie zastępuje walidacji użytkownika: zgodność z UI Health i znaczenie metryk nadal wymagają porównania i są opisywane z datą oraz ograniczeniami.

## Zasada rozliczania pracy

Przed implementacją zadania agent wybiera mały pionowy zakres i podaje kryteria. Po wykonaniu usuwa ukończone checkboxy z planu do `docs/completed/` oraz zapisuje wynik bieżących testów. Nie oznacza całego etapu jako niewykonanego wyłącznie przez pojedynczą pozostałą próbę telefonu; nie oznacza jako ukończonego bez tej próby, jeśli jest kryterium etapu.

Nie ma tu terminów i estymacji kosztu budowy. Nieznana dostępność API, podsumowań Gemini i mobilnego MCP ma osobne zadania badawcze z wynikiem także „niedostępne”.
