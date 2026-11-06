# Raport weryfikacji

Najnowsze wpisy na górze. Starsze (2026-11-02 – 2026-11-04): [archiwum](completed/04-test-results-archive.md). Pakiety instaluje pnpm; skrypty `npm run …` w raporcie działają tak samo jak `pnpm run …`.

## 2026-11-06 — rekonsyliacja starszych dób, kryteria odbioru M1, wirtualizacja tabeli

- `pnpm test`: 157 testów zaliczonych (nowe: `google-reconcile` — weryfikacja doby po końcu doby i po potwierdzeniu „bez zmian”, plan paczek bez luk i poza oknem odświeżania, ważność zależna od wieku, limit i kolejność, serwis z odczytem wymuszonym; `acceptance-flow` — sześć metryk od zapisanych stron do publikacji dla krojenia: cały zakres, doba po dobie, tydzień, 3 doby ze stronami po 40 punktów, porcje maksymalne ze stronami po 150, na zakresach z dobą 23 h, 25 h i zwykłą; powtórzone odczyty z polityką i bez niej; późna korekta jako jedna rewizja z wierszem audytu; Takeout obok API; restart w trakcie wielostronicowego odczytu). `pnpm run build`: poprawny (typecheck i Vite).
- Przeglądarka aplikacji (serwer dev i magazyn użytkownika, bez zapisu i bez żądań do Google): zakres „Od początku” (2014-03-01…2026-11-06) — 25 wierszy dni w DOM przy wysokości przewijanej ok. 177 000 px, po przewinięciu do środka i na koniec właściwe daty, szerokość tabeli stała, konsola bez błędów; zakres przywrócony do „Miesiąc”. Źródła danych: przycisk „Sprawdź starsze doby” i opis widoczne, konsola bez błędów.
- Rekonsyliacja na koncie użytkownika (po restarcie serwera na nowym kodzie; odczyty tylko do odczytu z Google): przebieg automatyczny — 2 paczki starszych dób, 310 dób bez zmian; przycisk „Sprawdź starsze doby” — 12 paczek w 19 s, wynik `ok`, 127 dób bez zmian, brak zadań niedokończonych, wszystkie 1415 zadań `complete`. Polityka odczytów w tym czasie: 37 identycznych odczytów odrzuconych jako potwierdzone, 4 starsze odczyty zastąpione (`superseded_after_correction_window`). Te 4 zastąpienia nie dowodzą późnych korekt producenta: zastępuje też odczyt o innym przekroju paczek, więc zmiany wartości nie rozróżniono (publikacja: 0 zmienionych dób). Przed restartem serwer działał na starym kodzie, więc pierwsze kliknięcie wykonało zwykłe odświeżenie. Nie sprawdzono: `verify:takeout` po tych zapisach (wymaga zatrzymanego serwera).
- Ograniczenia: testy automatyczne używają odczytów syntetycznych i atrapy `execute`/`send`. Odczyty list są czytane do 50 stron na zadanie — krojenia testowe mieszczą się w tym limicie. Praca w tle i polityka odczytów po wielu przebiegach: ocena użytkownika, bez pomiarów. Nie sprawdzono telefonu.

## 2026-11-06 — CI na pnpm

- CI przestawione z `npm ci` (brak `package-lock.json`) na `pnpm/action-setup` z pnpm 12.16.1 i `pnpm install --frozen-lockfile`. Lokalnie, Node z PATH, pnpm 12.16.1: `pnpm install --frozen-lockfile` bez zmian, `pnpm test` 146 testów zaliczonych, `pnpm run build` poprawny.
- Nie sprawdzono: przebiegu w GitHub Actions (zmiana niewypchnięta), Node 26 w macierzy.

## 2026-11-05 — magazyn v13: warstwa pochodna okien 10-minutowych

- `npm test`: 144 testy zaliczone (nowe: migracja 12→13 z kopią i oryginałami bez zmian; zapis okien razem ze stroną, odczyt z warstwy, wykrycie zmienionego wiersza przy weryfikacji, usunięcie po polityce odczytów; ta sama treść strony w zadaniach różnych rodzajów i brak wiersza wykrywany jako `missing_page_windows`). Łańcuchy migracji w testach kończą się na v13. `npm run build`: poprawny.
- Na kopii magazynu (poza repozytorium): migracja ok. 5 s, 390 wierszy pochodnych, 495 → 502 MB; `verifyTakeout` 2,1 s (v12) → 2,5 s (v13; bez indeksu stron po digeście było 26 s, indeks dodano do migracji). Pierwsze odczyty po starcie procesu: projekcja roku 339 → 101 ms, udział opaski 365 dni 109 → 24 ms, tętno 365 dni 34 → 10 ms; pierwsze `runOnce` 414 → 166 ms (najdłuższa blokada pętli 20 ms), 309 dób bez zmian.
- Magazyn użytkownika: `npm run migrate:canonical` przy zatrzymanym serwerze, kopia v12 zweryfikowana i przeniesiona do `D:\Trivimo-bak\przed-v13-20261105.sqlite` (porównana bajtowo). Po migracji serwer i automatyczne odświeżanie: wynik `ok`, 13 odczytów, 1 doba opublikowana, 308 bez zmian; `verifyTakeout` po tym zapisie poprawny (2,5 s). Przeglądarka: widok dnia bez błędów w konsoli; `sync-status` 12 ms, `day-range` 365 dni 71 ms, `band-share-range` 20 ms, `heart-rate-range` 12 ms, tętno i seria dnia 3–4 ms.
- Nie sprawdzono: przywrócenia kopii v13 skryptem `verify:restore` na magazynie użytkownika.

## 2026-11-05 — wydajność i bezpieczeństwo po przeglądzie (W2–W5, B2–B6)

- `npm test`: 141 testów zaliczonych (nowe: dni do ponownej projekcji; projekcja przyrostowa zgodna z pełną po nowym odczycie starej doby, usunięciu nowszego odczytu i końcu doby w toku; strony okien w pamięci pod digestem; odrzucenie ścieżek UNC i urządzeń; obcy callback OAuth nie przerywa autoryzacji, token odświeżany minutę przed wygaśnięciem). `npm run build`: poprawny. `pnpm audit`: brak znanych podatności (zod 4.6.7, csv-parse 7.0.3, Vite 7.3.7).
- Pomiary na magazynie użytkownika (odczyt; przebiegi odświeżania na kopii pliku poza repozytorium, bez żądań do Google): projekcja roku pierwszy raz w procesie 333 ms, kolejne ok. 60 ms; zakres band-share 365 dni 108 → 14 ms, tętno 365 dni 36 → 7 ms, kalendarz pokrycia 129 → 20 ms; pamięć procesu +7 MB. `runOnce` na kopii: pierwszy 414 ms łącznie z najdłuższą blokadą pętli 73 ms (309 dób bez zmian, czyli ten sam wynik co zapisane snapshoty), kolejne ok. 9 ms.
- Przeglądarka (serwer dev i API na magazynie użytkownika): widok dnia bez błędów w konsoli, pięć przejść strzałką w lewo bez nowego żądania `day-range`, podsumowanie i tabela wczytane; `sync-status` 12–14 ms, `day-range` 365 dni 77 ms, `band-share-range` 20 ms, `heart-rate-range` 25 ms, `coverage` 6 ms. Automatyczne odświeżanie po starcie: wynik `ok`, 1 doba opublikowana, 308 bez zmian.
- Nie sprawdzono: importu dużego Takeoutu i CSV z wielu lat w przeglądarce (zachowanie między porcjami pokrywają testy usługi), nowej autoryzacji Google po zmianie callbacku, działania przy jednoczesnym zapisie (timeout odczytu) na rzeczywistej bazie.

## 2026-11-05 — szybki status uzupełniania; Vite 7.3.7

- `npm test`: 136 testów zaliczonych (nowy: zapamiętane pokrycie zmienia się po dodaniu zadania, jego ukończeniu i usunięciu, także w kalendarzu roku). `npm run build`: poprawny (typecheck i build Vite 7.3.7).
- Pomiar `GoogleSyncService.status()` na magazynie użytkownika (tylko odczyt, 1379 ukończonych zadań): zakres od 2026-01-01 — pierwsze wywołanie 142 ms, kolejne ok. 7 ms (przed zmianą ok. 250 ms za każdym razem); zakres od 2000-01-01 — pierwsze 701 ms, kolejne ok. 7 ms (przed zmianą ok. 1,2 s za każdym razem).
- `pnpm audit` po podbiciu Vite (7.2.4 → 7.3.7): zostały zgłoszenia zod (< 4.6.6) i csv-parse (< 7.0.2), żadne dla Vite. Przeglądarka (serwer dev Vite 7.3.7 i API na magazynie użytkownika): widok „Pokrycie historii” się wczytuje, konsola bez błędów, `/api/google/sync-status` 11–18 ms. Nie sprawdzono: czasu statusu w trakcie rzeczywistego przebiegu uzupełniania.

## 2026-11-05 — pusta baza w bieżącej wersji przy starcie serwera

- `npm test`: 135 testów zaliczonych (nowy: pusta baza v12 w nowym katalogu przechodzi weryfikację, otwiera ją serwis CSV, drugi start i istniejący plik zostają bez zmian). `npm run typecheck`: poprawny. Serwer dev po zmianie wystartował na bazie użytkownika bez tworzenia nowej (plik istnieje). Nie sprawdzono: startu serwera z osobnym `TRIVIMO_DATA_DIR`, autoryzacji Google i importu Takeout do świeżej bazy v12.

## 2026-11-05 — import CSV: znak „%”, grupy cyfr, uwagi do dnia; globalne powiadomienie o uzupełnianiu

- Wycofanie importu obejmuje uwagi (magazyn v12, `user_note_sources`): `npm test` 134 testy zaliczone (nowe: wycofanie linii z edytowanej notatki, przywrócenie, linia usunięta przez użytkownika, pochodzenie doby; migracja 11→12 odtwarza pochodzenie wcześniejszych uwag i pozwala je wycofać). `npm run build`: poprawny. Migracja magazynu użytkownika 11→12 (`npm run migrate:canonical`, kopia `przed-v12-20261105.sqlite` poza repozytorium, zweryfikowana): wersja 12, istniejący import z uwagami dostał pochodzenie (12 dób w `csv_import_notes`, 12 rewizji w `user_note_sources`). Przeglądarka: lista importów z kolumną „Uwagi (doby)”, stanem „w danych” i przyciskiem „Wycofaj”; zakładka „Pochodzenie danych” doby z uwagą z CSV pokazuje sekcję „Importy CSV” (plik, metryki, „notatka r-1: dopisane uwagi”). Nie sprawdzono: kliknięcia „Wycofaj” na danych użytkownika (tylko test) i resetu formularza po udanym imporcie.

- Wykrywanie przecinka dziesiętnego w sugestii mapowania (także `"88,9"` w cudzysłowach w pliku z przecinkiem jako separatorem pól): `npm test` 133 testy zaliczone. Przeglądarka (magazyn użytkownika, bez zapisu): syntetyczny plik z `"88,9"`, `"12 345"` (NBSP) i `"20,90%"` — wybrany „przecinek”, podgląd 5 wartości, 0 odrzuceń.

- Grupy cyfr („12 345” z U+00A0, U+202F, U+2009 lub spacją, parser `csv-mapped-v3`): `npm test` 132 testy zaliczone (nowy test: także „2 150,5” i „20,90 %” z NBSP; „1 23”, „12 3456” i podwójny separator odrzucone). `npm run typecheck`: poprawny. Nie sprawdzono na rzeczywistym eksporcie z arkusza Google (tylko syntetyczne komórki).

- `npm test`: 131 testów zaliczonych (nowe: „20,90%” i „21,5 %” przy jednostce %, odrzucenie przy jednostce „ułamek”, uwagi z przycięciem i limitem 10 000 znaków; zapis uwag jako notatek dni: nowa notatka, dopisanie nowej rewizji do istniejącej, ponowny import bez zmian, limit długości, liczniki w podglądzie, wykluczenie importu zostawia notatki). `npm run typecheck`, `npm run build`: poprawne.
- Przeglądarka aplikacji (serwer dev, magazyn użytkownika, bez zapisu): syntetyczny plik ze średnikiem, „20,90%” i kolumną „Uwagi” — mapowanie zaproponowało kolumnę uwag i jednostkę %, podgląd: 2 wartości, 0 odrzuceń, 1 uwaga. Nagłówki tabeli metryk: „Metryka w Trivimo”, „Kolumna w pliku CSV”, „Jednostka w pliku CSV”. Nie sprawdzono w przeglądarce: zapisu importu i notatek w tabeli i widoku dnia (tylko test magazynu).
- Powiadomienie o końcu uzupełniania: przyciskami testowymi (później usuniętymi) sprawdzone przejście do `#zrodla/pokrycie`, zamknięcie i ukrycie na tej stronie. Nie sprawdzono na rzeczywistym zakończonym przebiegu.

