# Raport weryfikacji

## 2026-11-04 — kopia i odtworzenie (kryterium M1)

- `npm run backup:takeout -- D:/Trivimo-bak/kopia-m1-20261104.sqlite` przy działającym serwerze: kopia 367 MB w ok. 2 s. `npm run verify:restore` tej kopii: odtworzenie do pustego katalogu tymczasowego, skróty zgodne, integralność, oryginały Takeout, łańcuchy stron Google i snapshoty poprawne, odczyty źródeł i części dnia z opaską działają, a projekcja przebudowana z oryginałów jest równa opublikowanym snapshotom dla wszystkich 308 dób (2026-01-01 – 2026-11-04, 0 różnych, 0 nieopublikowanych). Czas ok. 19 s.
- `npm test`: 114 testów zaliczonych (nowy: osobny proces publikuje w pętli rewizje 30 dób i zostaje twardo zabity w losowej chwili; po ponownym otwarciu integralność poprawna, każda doba ma ostatnią zatwierdzoną rewizję w całości — wartość, uwagi i notatki z tego samego zapisu — a numery rewizji są ciągłe; test przeszedł trzy razy z rzędu). `npm run build`: poprawny.
- Ograniczenia: nie uruchamiano serwera aplikacji na odtworzonej kopii (port 3000 zajmował serwer użytkownika); token Google nie jest częścią kopii; kopia nie jest szyfrowana przez aplikację.

## 2026-11-04 — trendy w przeglądzie

- `npm test`: 113 testów zaliczonych (nowe: punkty serii — brak i nieporównywalne jako luka, zero producenta jako zero, oznaczenie doby częściowej i starszego modelu; średnia tylko z dób potwierdzonych z liczbą dób i luk; ostatni pomiar z datą; odcinki linii bez łączenia luk). `npm run build`: poprawny.
- Przeglądarka na prawdziwych danych: sekcja „Trendy” dla 90 i 365 dni, sześć wykresów, ostatnia masa i tłuszcz z datą, kreskowane słupki kalorii starszego modelu (97 dób), pusta przerwa w dobach samego BMR, linie masy tylko między kolejnymi dobami. Kolor jednej serii sprawdzony walidatorem palety: kontrast z tłem co najmniej 3:1 (pozostałe sprawdzenia dotyczą palet wieloseryjnych). Nie sprawdzano wąskiego ekranu.

## 2026-11-04 — automatyczne nadrabianie przerwy

- `npm test`: 110 testów zaliczonych (nowy: przebieg automatyczny na pustym magazynie czyta 13 dni, wykrywa starszą lukę i sam uruchamia uzupełnianie aż do pełnego pokrycia; po ręcznym zatrzymaniu kolejny przebieg nie wznawia go). `npm run build`: poprawny.
- Przeglądarka: nowe opisy paneli widoczne, tabela dni bez błędów. Oznaczenia doby bez odczytu nie dało się zobaczyć na prawdziwych danych (wszystkie doby 2026 są odczytane); sprawdzone tylko typami, bez testu UI.

## 2026-11-04 — sprawdzenie w przeglądarce

- Wbudowana przeglądarka aplikacji, `http://localhost:5173/` z serwerem użytkownika (`tsx watch`, magazyn w wersji 10), dane prawdziwe. Sprawdzono: tabelę dni dla 2026-10-06 – 2026-11-04 i 2026-04-01 – 2026-05-12 (sześć metryk, „Część dnia z opaską”, „Źródła”, uwagi, doba w toku), szczegóły komórek kalorii (pełny i starszy model, sam BMR), kroków, dystansu i masy (także ze scaloną kopią), panele „Odświeżanie bieżących dni” (13 rodzajów) i „Uzupełnianie historii” (3991 z 3991 dób). Konsola bez błędów.
- Poprawiono znalezione teksty: podwójna kropka po „szt.”, „nie odczytano okien” przy braku wartości dobowej, odmiana „kopia/kopie/kopii”, podział kalorii aktywnych 0,00/0,00 w dobach bez kalorii aktywnych (teraz pominięty) oraz nieaktualne opisy sekcji Google („wyniki nie są jeszcze kwalifikowane”). Po poprawkach `npm test` (109) i `npm run build` poprawne, szczegóły sprawdzone ponownie w przeglądarce.
- Uwagi bez zmian w kodzie: panel odświeżania podaje „pokryte do” także dla bieżącej doby czytanej w toku; doby 2026-04-30 – 05-05 mają małą „część dnia z opaską” z pomiarów tętna aparatem w Google Fit; doba 2026-10-11 ma w źródłach opaskę przy 0 % okien z tętnem. Widoku dnia, importu Takeout ani wąskiego ekranu telefonu nie sprawdzano.

## 2026-11-04 — masa i tkanka tłuszczowa (`google-body-v1`)

- `npm test`: 109 testów zaliczonych (nowe: średnia unikalnych pomiarów doby z dokładnym przeliczeniem g→kg, kopie z dwóch aplikacji liczone raz, konflikt przy tej samej chwili i różnej wartości, przypisanie do doby warszawskiej, doba w toku częściowa bez uwagi; odczyt masy i tłuszczu w odświeżaniu i backfillu; doba po północy z samą stawką bazową nie jest „samym BMR”, także bez kalorii aktywnych). `npm run build`: poprawny.
- Prawdziwa baza: backfill masy i tłuszczu (22 zadania, 307 dób). Porównanie z Takeout: te same liczby rekordów w tych samych miesiącach od 2026-04, brak pomiarów w styczniu–marcu. Przebieg na sucho i publikacja: masa i tłuszcz potwierdzone w dobach z pomiarem, pozostałe doby „Brak danych”; 18 kopii masy scalonych; ponowna publikacja bez zmian, 308 snapshotów przechodzi walidację. Wykryto i poprawiono fałszywe „tylko energia bazowa” oraz „nieporównywalne źródło” dla bieżącej doby tuż po północy; jedyna uwaga w tabeli to „Kalorie: tylko energia bazowa” (29 dób).
- Ograniczenia: wartości nie porównywano z aplikacją Health; tabeli w przeglądarce nie sprawdzano.

## 2026-11-03 — kwalifikacja kroków i dystansu (`google-activity-v1`)

- `npm test`: 108 testów zaliczonych (nowe: kroki i dystans z wartości producenta, przeliczenie mm→km, zgodność z oknami doby warszawskiej, niezgodność granicy doby jako nieporównywalna z uwagą, potwierdzone zero, doba w toku częściowa bez uwagi; doba bez odczytu kroków to brak danych). `npm run build`: poprawny.
- Prawdziwa baza: porównanie API z Takeout (tylko proporcje) potwierdziło, że producent nie sumuje kopii źródeł (zob. kontrakty). Przebieg na sucho: kroki i dystans potwierdzone na wszystkich 306 zakończonych dobach, suma okien równa wartości dobowej na każdej, doba bieżąca częściowa. Publikacja: 307 nowych rewizji, ponowna publikacja bez zmian, wszystkie snapshoty przechodzą walidację odczytu; jedyna uwaga w tabeli to „Kalorie: tylko energia bazowa” (29 dób).
- Ograniczenia: nie porównywano z wartościami w aplikacji Health; tabeli w przeglądarce nie sprawdzano.

## 2026-11-03 — ponawianie 503

- `npm test`: 107 testów zaliczonych (nowe: 503 z `Retry-After` w adapterze, 500 bez opóźnienia; ponawianie 503 listy i tożsamości konta, 500 i 401 bez ponowień; przebieg serwisu z krótkimi 503 kończy się sukcesem bez zdublowanych zadań, a trwałe 503 kończy przebieg kodem `google_http_503` bez wstrzymania kolejnych przebiegów). `npm run build`: poprawny.
- Ograniczenia: tylko odpowiedzi syntetyczne; na koncie nie wykonano nowego przebiegu.

## 2026-11-03 — kolumna źródeł (wersja 10)

- `npm test`: 106 testów zaliczonych (nowe: parsowanie listy źródeł i parametry żądania `fields`/`prettyPrint`, odrzucenie zakresu ponad 14 dni, 429; migracja 10 zachowuje zadania, strony i metadane odczytów, przyjmuje nowe rodzaje i odrzuca je przed migracją; źródła dnia — najnowszy odczyt wygrywa, odczyt bez wpisów to pusta lista, dzień bez odczytu nieznany; backfill obejmuje listy źródeł). `npm run build`: poprawny.
- Prawdziwa baza: migracja 9 → 10 po kopii `D:\Trivimo-bak\przed-v10-20261103.sqlite` (kopia: wersja 9; po migracji 207 zadań, 207 stron, 148 metadanych, `foreign_key_check` bez naruszeń). Backfill list źródeł tym samym serwisem co serwer: 88 zadań, 203 strony, ok. 42 MB surowych odpowiedzi za 306 dób, `verifyGooglePages` bez błędów. Dwa przebiegi zakończyły się przejściowym 503 (raz lista, raz tożsamość konta); ponowne uruchomienie kontynuowało od brakujących dób. Endpoint bez sesji zwraca 401, jak pozostałe.
- Przy ponownej publikacji kalorii (usunięcie uwagi starszego modelu) zapis zderzył się z działającym serwerem (`database is locked`, transakcja doby wycofana); serwis synchronizacji otwiera teraz bazę z oczekiwaniem na blokadę 5 s. Po ponowieniu jedyną uwagą kalorii jest „tylko energia bazowa” (29 dób).
- Ograniczenia: kolumny w przeglądarce nie sprawdzano.

## 2026-11-03 — kwalifikacja kalorii (`google-energy-v1`)

- `npm test`: 103 testy zaliczone (nowe: model doby — sam BMR z szumem i zerami, cicha doba telefonu z aktywnymi kcal, starszy model, doba zmiany czasu; ocena telefonu i źródła mieszanego; snapshoty z zapisanych stron: starszy model z uwagą, sam BMR pusty, pełny model z udziałem opaski i jawnym zerem aktywnych, odczyt przed końcem doby częściowy, doba bez odczytu okien nieporównywalna, nowa rewizja tylko po zmianie). `npm run build`: poprawny.
- Prawdziwa baza (2026-11-03): przebieg na sucho, potem publikacja dla 2026-01-01 – 2026-11-03: 307 dób ze snapshotem, ponowna publikacja bez zmian (0 nowych rewizji), wszystkie snapshoty przechodzą walidację odczytu. Wynik: 97 dób starszego modelu (wartość z uwagą), 29 dób samego BMR (puste), od 2026-05-07 pełny model; doba bieżąca częściowa. Pierwszą rewizję wszystkich dób opublikował wcześniej działający serwer z pośrednią wersją reguły (34 doby błędnie jako sam BMR, 29 jako nieustalone); rewizja 2 tych 63 dób to wersja poprawna, historia została zachowana.
- Ograniczenia: tabeli w przeglądarce nie sprawdzano; nie porównywano wartości z aplikacją Health poza wcześniejszymi próbami; BMR nie jest dostępny (zob. decyzje).
- Poprawki (2026-11-03): bieżąca doba bez uwagi „niepełny zakres”, progi modelu dla doby w toku względem minionych okien, kolumna „Część dnia z opaską” zamiast dopisku przy kaloriach. 103 testy zaliczone, build poprawny; na prawdziwej bazie bieżąca doba ma rewizję bez uwag, pozostałe doby bez zmian.

## 2026-11-03 — uzupełnianie historii (backfill)

- `npm test`: 99 testów zaliczonych (2 nowe: pokrycie dób tylko po ich końcu, podział luk na paczki w limitach, granice dób warszawskich w paczce obejmującej zmianę czasu; przebieg serwisu z zatrzymaniem po paczce, wznowieniem bez powtórzeń, ponowieniem i oczekiwaniem po trwałym 429 oraz pustym kolejnym przebiegiem). `npm run build`: poprawny.
- Ograniczenia testów: tylko odpowiedzi syntetyczne. Masa i tkanka tłuszczowa nie są objęte.
- Przebieg na koncie użytkownika (2026-11-03, uruchomiony przez użytkownika, zakończony): sprawdzenie tylko do odczytu skryptem poza repozytorium. Wszystkie dziewięć rodzajów pokrywa 306 dób (2026-01-01 – 2026-11-02), plan uzupełniania jest pusty, 207 zadań w stanie „complete” i żadne w toku, każde zadanie ma jedną stronę, `verifyGooglePages` bez błędów, 3 usunięcia polityki odczytów (pośrednie odczyty doby w toku). Strony Google zajmują razem ok. 13,5 MB; baza urosła o ok. 11 MB.
- Spójność: sumy okien 10-minutowych w dobie warszawskiej równe agregatowi `dailyRollUp` dla kroków i dystansu na 306 dobach, dla kalorii total na 304 dobach dokładnie i na 2 z różnicą poniżej 0,1 %, dla aktywnej energii na wszystkich 180 dobach z wartością. Aktywna energia ma wartości od 2026-05-07 bez luk, okna tętna od 2026-04-30 (135 dób z co najmniej jednym oknem); wcześniejsze doby API nie zwraca i pozostają brakiem, nie zerem. Nie porównywano z Takeout ani z aplikacją Health, a panelu w przeglądarce nie sprawdzał agent.

## 2026-11-03 — 429 i rodzina źródeł

- `npm test`: 97 testów zaliczonych (5 nowych: odczyt `Retry-After` w sekundach i jako data HTTP, nieznana wartość to brak, a nie zero; kod błędu i opóźnienie z adaptera; ponawianie tylko 429; wyczerpanie prób i zbyt długie opóźnienie; przebieg serwisu z dwoma 429, który kończy się bez zdublowanych stron, oraz trwałe 429, po którym zadanie zostaje przy zapisanym kursorze, a następny przebieg do podanego czasu nie wysyła żądań). `npm run build`: poprawny.
- Rodziny źródeł nie porównywano ponownie: wynik z tego dnia jest w [kontraktach](data-contracts.md). Zmiana tylko ujednolica stałą `all-sources` w obu adapterach rollupów; kształt żądań się nie zmienił.
- Ograniczenia: tylko odpowiedzi syntetyczne; prawdziwego 429 od Google nie zaobserwowano, więc nie wiadomo, czy wysyła `Retry-After`. Wstrzymanie żyje w pamięci procesu i znika po restarcie serwera. Komunikatu w przeglądarce nie sprawdzano.

## 2026-11-03 — adapter dziennego agregatu Google (kroki, dystans)

- `npx tsc --noEmit` bez błędów; `npx tsx --test tests/*.test.ts`: 73 testy zaliczone (3 nowe: jawne zero versus brak, odrzucenie okien innych niż doba, kształt żądania, limit 90 dni, HTTP 429). Wspólny czytnik odpowiedzi z limitem rozmiaru wydzielono z odczytu masy bez zmiany zachowania.
- Migracja v6 (`migrate:canonical`, przebudowa tabel zadań Google z zachowaniem danych i klucza obcego): test syntetyczny v1→v6 oraz próba na właściwej bazie po kopii `D:\Trivimo-bak\przed-v6-20261103.sqlite`; po migracji wersja 6, zachowane 2 zadania i 2 strony, `foreign_key_check` bez naruszeń. Ręczny odczyt próbny na koncie użytkownika (2026-11-03): po jednym zadaniu kroków i dystansu dla doby 2026-11-02 zakończyło się po jednej stronie z jednym punktem `rollupDataPoints` i bez `nextPageToken`; wartości nie analizowano ani nie zapisano w docs. To potwierdza kształt odpowiedzi dla pojedynczej doby z danymi, nie zachowanie dla doby bez danych, dłuższych zakresów ani paginacji.
- Ograniczenia: tylko odpowiedzi syntetyczne zgodne z dokumentacją z 2026-11-03; brak realnego wywołania konta, kwalifikacji i projekcji dnia.
- Kalorie (2026-11-03): adapter i zadania obsługują `total-calories` (limit 14 dni, pageSize 14) oraz `active-energy-burned` (90 dni); pole `kcalSum` jest liczbą JSON, więc zapis jej tekstu zachowano bez zaokrąglenia. Migracja v7 (przebudowa tabel zadań) wykonana na właściwej bazie po kopii `D:\Trivimo-bak\przed-v7-20261103.sqlite`: wersja 7, 4 zadania i 4 strony zachowane, `foreign_key_check` bez naruszeń; w chwili migracji na porcie 3000 działał serwer ze starszym kodem. 79 testów zaliczonych, `tsc` czysto. Kalorie nie były jeszcze odczytane z konta; nie ustalono polityki kwalifikacji, a total zawiera BMR.
- Migracja v9 (okna `steps-10m`, `distance-10m`, `total-calories-10m`, tabele `google_read_job_meta` i `google_read_supersessions`) wykonana na właściwej bazie po kopii `D:\Trivimo-bak\przed-v9-20261103.sqlite`: wersja 9, 47 zadań i 47 stron zachowane, `foreign_key_check` bez naruszeń. Odczytano okna 10-minutowe kroków, dystansu i total dla wybranych dób; suma godzin zgadza się z dziennym agregatem co do tysięcznych części (kalorie na wszystkich sprawdzonych dobach, kroki i dystans na dobach z odczytem dobowym), a maksimum godziny total dla 1 listopada (około 489 kcal) zgadza się ze słupkiem Health. Polityka odczytów (`applyReadPolicy`): testy syntetyczne obejmują pominięcie identycznego odczytu z potwierdzeniem, zastąpienie pośredniego odczytu doby w toku, zachowanie różnych wartości w oknie trzech dób, zastąpienie po jego upływie, ochronę odczytów ręcznych i innych kont oraz audyt; 92 testy zaliczone, `tsc` czysto. Na prawdziwej bazie pierwszy przebieg po migracji nie wywołał jeszcze żadnego usunięcia (brak wcześniejszych odczytów automatycznych o tym samym zakresie), więc zachowanie polityki na prawdziwych danych nie zostało zaobserwowane. Widoku „Przebieg doby” nie sprawdzano w przeglądarce.
- Kolumna „Udział opaski” w tabeli dni i oznaczenie doby w toku: odczyt zakresu (`readBandShareRange`, strony każdego zadania parsowane raz, najnowszy pełny odczyt doby wygrywa, „odczytano, brak okien” to 0 %, a nie odczytano to „—”). 87 testów zaliczonych, `tsc` czysto, w tym endpoint (200 dla poprawnego zakresu, 400 powyżej 365 dni). Na prawdziwej bazie zakres od 2026-01-01 do 2026-11-03 liczy się w ok. 26 ms, a wartości zgadzają się z wcześniejszym odczytem pojedynczych dób (42 doby z odczytem tętna). Widoku w przeglądarce nie sprawdzano. Kolumna jest niezależna od snapshotów kanonicznych, które nadal nie są liczone z danych Google.
- Odświeżanie bieżących dni (`GoogleSyncService`, plan odczytów `planSync`): 86 testów zaliczonych, `tsc` czysto; testy syntetyczne obejmują pustą bazę, brak powtórzeń odczytanych zakresów, powrót dzisiejszej doby po upływie czasu, nadrabianie przerwy (także limit 13 dni i granice okien UTC), wznowienie niedokończonego zadania, zatrzymanie na pierwszym błędzie i brak wycieku treści błędu. Jeden prawdziwy przebieg na koncie użytkownika 2026-11-03: wynik ok, 14 odczytów (12 zaplanowanych i 2 wznowione niedokończone zadania), po nim brak zadań w toku, a bezpośrednio następny przebieg nic nie odczytał. Nie sprawdzono pracy w tle po kilku godzinach, zachowania po restarcie komputera ani widoku w przeglądarce.
- Migracja v8 (zadania okienkowe `heart-rate-10m` i `active-energy-10m`) wykonana na właściwej bazie po kopii `D:\Trivimo-bak\przed-v8-20261103.sqlite`: wersja 8, 24 zadania i 23 strony zachowane, `foreign_key_check` bez naruszeń. Odczytano okna 10-minutowe tętna i aktywnej energii dla wybranych dób sierpnia, października i listopada; sumy okien aktywnej energii zgodne z agregatem dziennym na pełnych dobach, a udział opaski odpowiada Takeout (m.in. doba z opaską całą dobę 100 %, doby bez opaski 0 %). 83 testy zaliczone, `tsc` czysto. Widoku w przeglądarce nie sprawdzano.
- Skrypt `npm run google:read -- <rodzaj> <od> <do włącznie>` (zmienna `TRIVIMO_GOOGLE_CLIENT_FILE`) czyta zakres przez ten sam kod co panel i wypisuje tylko status oraz kody błędów; pomija zakres już odczytany (`--again` wymusza). Użyty 2026-11-03 do porównania API z Takeout dla 41 dób total i 91 dób active (wyniki jako reguły w [kontraktach](data-contracts.md)); jedno wywołanie tożsamości zwróciło przejściowe 503 i powtórzenie przeszło. Kod nie wypisuje wartości ani sekretów.
- Widok dnia „Agregaty dzienne Google" (`GET /api/google/daily-candidates`): pokazuje zapisane wartości kroków i dystansu z jednej doby producenta jako oryginał i przeliczenie (mm → km dokładnym przesunięciem przecinka), bez sumowania, uzgadniania i kwalifikacji. Testy syntetyczne (76 zaliczonych, `tsc` czysto) obejmują jawne zero, brak wartości, kilka odczytów i kilka kont. Widoku nie sprawdzano w przeglądarce na realnych danych. Test nie potwierdza, czy API zwraca doby bez danych ani jak działa paginacja.

## 2026-11-03 — diagnostyka listy zadań Google

- `pnpm exec tsx --test tests/google-job-day.test.ts tests/google-pages.test.ts`: 3 testy syntetyczne zaliczone poza sandboxem, w tym rozróżnienie błędów bez ujawniania szczegółów. `pnpm run build` i `git diff --check`: poprawne na Node 26.13.0.
- Wcześniejszy komunikat przypisywał każdy błąd listy migracji. Nie udało się połączyć z instancją użytkownika pod `127.0.0.1:5173`, więc przyczyna konkretnego błędu pozostaje nieustalona; ręcznej weryfikacji po poprawce nie wykonano. Nie czytano prywatnej bazy ani pomiarów.

## 2026-11-03 — tożsamość kandydatów i konta Google

- `node --import tsx --test tests/google-body-source-day.test.ts tests/body-source-day.test.ts`: 6 testów syntetycznych zaliczonych poza sandboxem, w tym wiele kont bez zapisanych stron oraz ochrona identyfikatorów. `npm run build`: poprawny na Node 26.13.0.
- Widok pokazuje stan identyfikacji kandydata; nie potwierdza tożsamości między źródłami ani nie publikuje wyników. Nie wykonano ręcznej próby przeglądarki ani odczytu prywatnych pomiarów. Próba uruchomienia przez pnpm wymagała odtworzenia zależności z istniejącego `package-lock.json` przez `npm ci`; menedżera pakietów projektu nie zmieniono.

## 2026-11-03 — Node 26 LTS

- Na zainstalowanym Node 26.13.0 `node --import tsx --test --test-timeout=10000 tests/google-pages.test.ts`, pełne `npm test` (67 testów) i `npm run build`: poprawne. Testy lokalnego API uruchomiono poza sandboxem. `tsx` wypisuje ostrzeżenie deprecacji `module.register()`.
- Zakres obsługiwanych wersji obejmuje Node 24 oraz Node 26 od 26.13; konfiguracja CI przewiduje oba warianty. CI nie zostało uruchomione w tej sesji. Prywatnej bazy i rzeczywistego odczytu Google nie sprawdzano.

## 2026-11-03 — ponowienie testu magazynu na Node 24

- Systemowy Node 26.7.0 zatrzymał test `google-pages.test.ts` podczas pierwszej kopii SQLite przed migracją; przyczyna techniczna zatrzymania nie została ustalona. Projekt wymaga Node 24.
- Na Node 24.22.1 `node --import tsx --test tests/google-pages.test.ts`: zaliczony. Następnie `npm test` z Node 24.22.1 w PATH: 67 testów syntetycznych zaliczonych poza sandboxem, w tym test magazynu i lokalnego API. Nie sprawdzano prywatnej bazy ani rzeczywistego odczytu Google.

## 2026-11-03 — dzień warszawski w zadaniu Google

- `npx tsx --test tests/google-job-day.test.ts tests/warsaw-day.test.ts tests/google-body-read.test.ts`: 5 testów syntetycznych zaliczonych poza sandboxem, w tym REST, kompatybilność poprzedniego formatu zakresu oraz obie zmiany czasu. `npm run build`: poprawny.
- Test `tests/google-pages.test.ts` nie zakończył się podczas dwóch prób i został przerwany; przyczyny nie ustalono. Nie wykonano ręcznej próby interfejsu ani rzeczywistego odczytu Google. Istniejące zadania zachowują swoje zapisane zakresy.

## 2026-11-03 — zakresy zapisanych odczytów Google

- `npx tsx --test tests/google-body-source-day.test.ts tests/body-source-day.test.ts`: 5 testów syntetycznych zaliczonych poza sandboxem; obejmują zadanie bez zapisanych stron, granice dnia przy zmianie czasu i brak ujawniania identyfikatorów. `npm run build` i `git diff --check`: poprawne.
- Podgląd pokazuje do 50 zapisanych zadań nakładających się na dzień, ich zakresy UTC i stan. Zakończenie zadania nie potwierdza kompletności źródła ani tożsamości kont. Nie wykonano ręcznej próby przeglądarki ani odczytu prywatnych pomiarów.

## 2026-11-03 — porównanie źródeł w widoku dnia

- `npx tsx --test tests/body-source-day.test.ts tests/google-body-source-day.test.ts`: 4 testy syntetyczne zaliczone poza sandboxem; w sandboxie test HTTP nie mógł połączyć się z localhost. `npm run build` i `git diff --check`: poprawne.
- Wspólny wybór typu pokazuje kandydatów Takeout i Google dla tej samej daty; odczyty i błędy pozostają niezależne. Widok nie rozstrzyga tożsamości ani kompletności i nie tworzy wyniku dnia. Nie wykonano ręcznej próby przeglądarki ani porównania prywatnych pomiarów.

## 2026-11-03 — przegląd kandydatów Google

- `npm test`: 65 testów syntetycznych zaliczonych; po doprecyzowaniu wczesnego zatrzymania odczytu ponowiono 3 testy `google-body-source-day.test.ts` z powodzeniem. `npm run build` i `git diff --check`: poprawne. Testy obejmują dzień Warszawy, zakres stron, dokładną liczbę i ochronę identyfikatorów w odpowiedzi.
- Po ponownym uruchomieniu serwera punkt odczytu dla jednej daty i typu odpowiedział HTTP 200; nie wyświetlano wartości, identyfikatorów ani liczby pomiarów. Interfejs nie został sprawdzony ręcznie. Restart zakończył sesję OAuth; przegląd zapisanych danych nie wymaga nowej zgody.

## 2026-11-03 — pusta tabela dni

- Lokalny odczyt stanu wybranej daty potwierdził dostępność bazy i brak zapisanej projekcji dnia, bez wyświetlania pomiarów. Dodano komunikat dla zakresu bez projekcji i przejście do danych źródłowych. `npm run build` i `git diff --check`: poprawne.
- Próba uruchomienia przeglądarki do kontroli interfejsu nie powiodła się; ręczne sprawdzenie pozostaje otwarte. Sama zmiana komunikatu nie wdraża kwalifikacji ani przeliczania źródeł.

## 2026-11-03 — ograniczony rzeczywisty odczyt Google

- Po ponownej zgodzie uruchomiono jedno zadanie `weight` dla jednej zakończonej doby UTC (2026-11-02). Żądanie zwróciło pierwszą, ostatnią stronę, którą zapisano z kursorem w bazie. Nie wyświetlano ani nie analizowano wartości lub identyfikatorów rekordów; nie ustalano, czy strona zawiera pomiary.
- `npm test`: 62 testy syntetyczne zaliczone po podłączeniu REST i panelu. `npm run build` i `git diff --check`: poprawne. Ręcznej próby panelu nie wykonano.
- Wynik nie potwierdza historii, pozostałych metryk, paginacji rzeczywistej odpowiedzi, zgodności Takeout ani kwalifikacji. Kopia sprzed migracji nie zawiera tej późniejszej strony.

## 2026-11-03 — magazyn stron Google

- `npm test`: 62 testy syntetyczne zaliczone przed dodaniem punktów REST i panelu. Następnie `npx tsx --test tests/google-pages.test.ts` zaliczył syntetyczny przepływ REST, weryfikację dostępu, zachowanie oryginalnego JSON, wznowienie, błędy i ochronę przed zmianą konta. `npm run build` i `git diff --check`: poprawne. Ręcznej próby panelu nie wykonano.
- `npm run migrate:canonical -- <ścieżka kopii>`: po testach utworzono i zweryfikowano kopię w katalogu wskazanym przez użytkownika oraz zmigrowano właściwą bazę do wersji 5. Serwer uruchomiono ponownie i potwierdzono dostępność punktu zadań. Realnego odczytu Google i kwalifikacji nie wykonano.

## 2026-11-03 — autoryzacja konta i odczyt syntetyczny

- Użytkownik zakończył autoryzację; lokalny status potwierdził oba wymagane zakresy. Nie odczytano pomiarów z konta. Autoryzacja pozostaje w pamięci bieżącego procesu.
- `npx tsx --test tests/google-body-read.test.ts`: 2 testy zaliczone; `npm run typecheck` i `git diff --check`: poprawne. Adapter strony odczytu nie jest jeszcze podłączony do serwera ani trwałego magazynu. Rzeczywisty odczyt, paginacja na koncie i kwalifikacja pozostają nieweryfikowane.

## 2026-11-03 — lokalna autoryzacja Google

- `npm test`: 59 testów syntetycznych zaliczonych poza piaskownicą; `npm run build` i `git diff --check`: poprawne. Testy OAuth obejmują PKCE, jednorazowy state, ochronę żądania, brak tokenów w odpowiedzi oraz zachowanie po błędzie.
- Nie wykonano autoryzacji konta ani odczytu Google Health, ani ręcznej próby interfejsu. Tokeny są wyłącznie w pamięci; brak odnawiania i trwałego magazynu.

## 2026-11-03 — plan porcji Google Health

- `npx tsx --test tests/rollup-plan.test.ts tests/sort-days.test.ts`: 3 testy zaliczone. `npm run build`: poprawny; `npm test`: 56 testów zaliczonych poza piaskownicą. Testy planowania obejmują granice porcji, zmianę czasu i niepoprawne zakresy cywilne; nie obejmują wywołania API.

## 2026-11-03 — sortowanie wartości i szczegóły

- `npx tsx --test tests/sort-days.test.ts`: zaliczony test dokładnego porównania dużych liczb i ułamków, z brakami na końcu w obu kierunkach. `npm run build` i `git diff --check`: poprawne.
- Szczegóły są ograniczone do danych zapisanych w projekcji. Ręczna próba przeglądarki nie została wykonana.

## 2026-11-03 — wybór metryk i kolejność dni

- `npm run build` i `git diff --check`: poprawne. Zmiana dotyczy wyłącznie prezentacji już pobranego zakresu.
- Nie wykonano ręcznej próby w przeglądarce; nie używano prywatnych pomiarów.

## 2026-11-03 — tabela zakresu dni

- `npm run build`: poprawny. Test syntetyczny REST zakresu potwierdził ostatnią rewizję, lukę i walidację granic. `npm test`: 53 testy zaliczone poza piaskownicą po błędach dostępu do localhost i dowiązań w piaskownicy. `git diff --check`: poprawny.
- Widok nie został sprawdzony ręcznie w przeglądarce. Nie wykonywano odczytu ani przeliczenia prywatnych pomiarów.

## 2026-11-03 — lokalne konto i przegląd źródeł

- Po potwierdzeniu użytkownika wykonano migrację schematu do wersji 4: utworzono lokalne konto i przypisano istniejące sesje. Przed zmianą `migrate:canonical` wykonał i zweryfikował kopię w wybranej lokalizacji. Po migracji `verify:takeout` potwierdził integralność oryginałów; osobna kontrola potwierdziła kompletność przypisań bez wypisywania identyfikatorów ani pomiarów.
- `npm test`: 52 testy syntetyczne zaliczone na Node 24.22.1; obejmują m.in. jawne przypisywanie konta, nieprzypisane i wznawiane importy, kwalifikację kroków/dystansu oraz odczyt kandydatów z uwzględnieniem dnia Warszawy. `npm run build` i `git diff --check`: poprawne.
- W osobnej syntetycznej bazie i przeglądarce sprawdzono wybór konta w imporcie oraz podgląd pomiarów źródłowych dnia. Klucz z czasu i pochodzenia pozostaje tylko kandydatem; nie dokonano automatycznej deduplikacji ani kwalifikacji rzeczywistych rekordów.
- Nowy import bez potwierdzenia konta pozostaje nieprzypisany; interfejs umożliwia późniejsze jawne przypisanie zakończonych importów po podglądzie i potwierdzeniu. Test syntetyczny sprawdza zamrożenie zestawu, jednorazowy token i konflikt decyzji. OAuth, automatyczna ocena replik i wyliczenie wyników dnia pozostają otwarte.

## 2026-11-03 — historia notatek

- `npm test`: 45 testów syntetycznych zaliczonych na Node 24.22.1; obejmują niezależność notatki od automatycznych uwag, historię wersji, konflikt rewizji i ochronę żądań zapisu. `npm run build` i `git diff --check`: poprawne.
- Syntetyczne API i przeglądarka na osobnych portach: zapis notatki, ponowny odczyt po odświeżeniu oraz pozostawienie niezapisanej treści po anulowaniu przejścia. Bez użycia prywatnych pomiarów.
- `npm run migrate:canonical -- <nowa kopia>`: po syntetycznej próbie utworzono i zweryfikowano kopię właściwej bazy na wskazanym dysku D:, po czym dodano schemat historii notatek jako wersję 3. `npm run verify:takeout` po migracji potwierdził integralność oryginałów. Nie dodano ani nie zmieniono prywatnych notatek użytkownika.
- Ograniczenia: rzeczywiste pomiary nadal nie są powiązane z decyzjami tożsamości ani automatycznie przeliczane. Odczyt API Google pozostaje wyłączony na życzenie użytkownika; M1 nie jest ukończone.

## 2026-11-03 — syntetyczna projekcja dnia i migracja

- `npm test`: 41 testów syntetycznych zaliczonych na Node 24.22.1; obejmują jawną kwalifikację, brak/zero, migrację z kopią, rewizje i przepływ od syntetycznych dowodów do REST. `npm run build`: poprawny. Połączenie danych źródłowych z jawnymi decyzjami nadal nie jest wdrożone.
- 2026-11-02, osobne syntetyczne API i przeglądarka: widok dnia pokazał sześć metryk, potwierdzone zero, brak i uwagę w jednej rewizji. Próba nie wykorzystywała prywatnych pomiarów.
- 2026-11-02 wskazano nowy katalog na dysku D:. `backup:takeout`, `verify:takeout` i `verify:restore` zakończyły się powodzeniem; kopię odtworzono w pustym katalogu tymczasowym, porównano skróty, sprawdzono integralność i usunięto tymczasowy plik.
- 2026-11-02 po pozytywnych testach `migrate:canonical` utworzył i zweryfikował dodatkową kopię przed migracją, zmienił schemat prywatnej bazy do wersji 2 i ponownie sprawdził oryginały. Migracja nie wyliczyła ani nie opublikowała wyników z prywatnych danych.
- Odczyt API Google pozostaje wyłączony na życzenie użytkownika. Błąd pełnego odczytu starej kopii na F: został odtworzony również przez użytkownika w Eksploratorze; plik na F: nie był nadpisywany.

## 2026-11-02 — reguły M1 i próba odtworzenia

- Po wskazaniu innego dysku utworzono nową kopię, sprawdzono ją `npm run verify:takeout`, a następnie `npm run verify:restore` odtworzył ją do pustego katalogu tymczasowego, porównał skróty i zweryfikował zawartość bez wypisywania pomiarów. Tymczasowy plik usunięto. Dotyczy to obecnego magazynu oryginałów, nie przyszłych załączników ani zadań, których jeszcze nie ma.
- `npm test`: 36 testów syntetycznych zaliczonych na Node 24.22.1; obejmują kwalifikację kalorii na podstawie jawnych dowodów, średnie zaakceptowanych pomiarów masy/tłuszczu, czas źródła i DST oraz deterministyczne uwagi. `npm run build` i `git diff --check`: poprawne. Te reguły nie są jeszcze podłączone do wyników dnia.
- `npm run verify:takeout`: oryginalna baza przeszła kontrolę integralności, skrótów plików i odczytu typów bez wypisywania pomiarów.
- `npm run verify:restore -- <syntetyczna kopia>`: odtworzenie i weryfikacja zakończone powodzeniem poza sandboxem.
- Prywatna kopia: próba SQLite backup API utknęła i została przerwana; pliki tymczasowe usunięto. Kolejna próba pełnego odczytu zamkniętej kopii zwróciła błąd urządzenia dysku docelowego. Oryginalna baza i kopia nie były zmieniane. Prywatne odtworzenie pozostaje niewykonane mimo wcześniejszej udanej weryfikacji kopii.
- OAuth i porównanie z API pozostają wstrzymane zgodnie z decyzją użytkownika; nie są dowodem ukończenia M1.

## 2026-11-02 — import z interfejsu i ponowne uruchomienie

- `npm test` i `npm run build`: testy syntetyczne oraz build poprawne na Node 24.22.1. Test HTTP obejmuje sesję, Origin, wymagany nagłówek, podgląd bez zapisu, zatwierdzenie, zmianę pliku, wznowienie zapisanego planu i ponowne użycie tokenu.
- Przeglądarka `localhost:5173` i osobna syntetyczna baza: podgląd, potwierdzenie importu i widok zaimportowanego wiersza działają. Nie użyto prywatnych danych w narzędziu przeglądarkowym.
- `scripts/start-trivimo.ps1`: uruchomienie z syntetyczną bazą poprawne. Po uruchomieniu poza sandboxem z właściwą bazą lokalne żądanie odczytu zwróciło HTTP 200; sprawdzono sam status bez wyświetlania pomiarów. Procesy uruchomione przez narzędzia mogą zakończyć się wraz z ich sesją; `start-trivimo.cmd` służy do uruchomienia przez użytkownika poza sandboxem.
- Ograniczenia: wybór katalogu wymaga wpisania pełnej ścieżki, a nie systemowego okna wyboru. Import nadal zachowuje pozostałe pliki jako oryginały, bez interpretacji i bez wyliczenia wyników dziennych.

## 2026-11-02 — niedostępna baza w serwerze

- `npm test`: 26 testów zaliczonych na Node 24.22.1, w tym wybór lokalizacji bazy i ponowny odczyt po jej udostępnieniu. `npm run build`: poprawny.
- Po uruchomieniu lokalnego serwera z dostępem do właściwej bazy żądania przez `localhost:5173` i `127.0.0.1:5173` zwróciły HTTP 200. Sprawdzono jedynie status, bez zapisu ani wyświetlania pomiarów. Zakładka została nazwana „Dane Takeout”; nadal nie jest to interfejs uruchamiania nowego importu.

## 2026-11-02 — kopia prywatna i jednostki

- `npm run backup:takeout -- <wskazana lokalizacja>` oraz `npm run verify:takeout -- <plik kopii>`: utworzono kopię poza dyskiem źródłowym i sprawdzono integralność bazy, skróty, liczbę wierszy oraz odczyt typów. Aplikacja nie szyfruje pliku; nie wykonano jeszcze osobnego odtworzenia prywatnej kopii do środowiska aplikacji.
- `npm test`: 24 testy syntetyczne zaliczone na Node 24.22.1, w tym bezstratne przeliczenia jednostek, dokładne średnie jako ułamki, zera, błędy i ograniczenia interpretacji kalorii. Testy lokalnego API uruchomiono poza ograniczeniem sandboxa dla loopback.
- `npm run build`: kontrola typów i build zakończone powodzeniem. Przeliczenie wartości źródłowej nie jest kwalifikacją wyniku dnia ani oceną replik.
- Przeglądarka z syntetyczną bazą: przeliczenie jednostek, filtr daty źródłowej i komunikat przy braku wyników działają. `npm run verify:takeout -- <plik kopii>` sprawdził odczyt i filtr daty sześciu typów bez wypisywania pomiarów.

## 2026-11-02 — lokalny import Takeout

- `npm test`: 21 testów syntetycznych zaliczonych na Node 24.22.1; obejmują zachowanie plików i pól CSV, nieinterpretowanych oryginałów, limity, powtórzenie importu, przerwanie i wznowienie, wykrycie zmienionego pliku, nieznany schemat, chroniony odczyt oryginałów i obsługę błędu kopii. Test HTTP wymagał połączenia loopback poza ograniczeniem sandboxa.
- `npm run build`: typy i build interfejsu poprawne na Node 24.22.1.
- `npm run preview:takeout -- <wskazany katalog>` oraz `npm run import:takeout -- <wskazany katalog>`: zakończone powodzeniem dla plików Google Health z prywatnego eksportu; wiersze odczytano dla sześciu typów, pozostałe pliki zachowano bez interpretacji. Pomiary i rekordowe ID nie zostały zapisane w dokumentacji ani fixture'ach.
- `npm run verify:takeout`: integralność SQLite, skróty zachowanych plików, powiązania i liczby wierszy poprawne; sprawdzono też odczyt pierwszej strony sześciu typów bez wypisywania wartości. Odczyt prywatnej bazy w tym środowisku wymagał uruchomienia poza sandboxem. To nie jest porównanie z UI Google Health ani walidacja znaczenia kalorii.
- Przeglądarka: w osobnej syntetycznej bazie sprawdzono sesję, wyświetlenie oryginalnych pól oraz stan pustego typu. Prywatnych pomiarów nie wyświetlano w narzędziach weryfikacji.
- Ograniczenia: rozpoznano wiersze tylko sześciu typów; interpretacja pozostałych plików, rozpakowywanie ZIP, kwalifikacja i uzgadnianie replik, dzienne projekcje, szyfrowanie oraz realne porównanie z innym źródłem pozostają niewykonane. Kopię prywatnej bazy wykonano później, jak opisano wyżej.

## 2026-11-02 — próby P0 i reguły domenowe

- `npm test`: 16 testów zaliczonych na Node 24.22.1; obejmują m.in. ograniczony czytnik CSV, kopię i odtworzenie syntetycznej bazy, DST, średnią unikalnych pomiarów, konflikt rewizji i atomowość, Host/Origin oraz przebieg SQLite → REST. Test HTTP wymagał połączenia loopback poza ograniczeniem sandboxa.
- `npm run build`: typy i build interfejsu poprawne na Node 24.22.1.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/spike-takeout.ps1`: syntetyczna próba kompilacji i wykonania wybranych parserów Kotlin zakończona powodzeniem; lokalny kompilator wypisał ostrzeżenie o przestarzałym API JDK. Zakres i wnioski: [próby P0](completed/01-p0-probes.md).
- Przeglądarka na lokalnym Vite: tabela i wykres pokazały liczbę, brak, zero i uwagę, a `/api/days` zwróciło 200. Po celowym zatrzymaniu API pokazano komunikat błędu. Nie sprawdzano telefonu, konta ani danych rzeczywistych.
- Dzień warszawski korzysta z bazy stref środowiska wykonawczego. Test obejmuje przejścia DST 2026 i sąsiednie granice, nie każdą przyszłą zmianę przepisów strefowych. Nowe reguły i czytnik CSV nie są jeszcze podłączone do importu ani produkcyjnego magazynu. Kopia nie obejmuje załączników, szyfrowania ani automatycznej migracji.

## 2026-11-02 — migracja syntetycznego schematu

- `npm test`: 5 testów zaliczonych na Node 24.22.1; obejmują ponowne otwarcie syntetycznej bazy plikowej, ponowienie migracji, spójność null/zero, odrzucenie przyszłej wersji i rollback po błędzie. Lokalny test HTTP wykonano poza ograniczeniem sandboxa dla loopback.
- `npm run build`: typy i build interfejsu poprawne na Node 24.22.1.
- To wyłącznie migracja początkowa i test pliku tymczasowego; serwer nie ma jeszcze trwałej bazy, kopii przed migracją ani testu odtwarzania. Nie wykonano próby na prywatnym eksporcie ani w przeglądarce.

## 2026-11-02 — syntetyczny przykład P0

- `npm test`: 2 testy zaliczone, w tym baza SQLite → lokalne HTTP i rozróżnienie `null`/0. Sandbox blokował połączenie loopback; ponowienie poza ograniczeniem zakończyło się powodzeniem.
- `npm run build`: typy poprawne, produkcyjny build interfejsu poprawny.
- Środowisko wykonania: Windows, Node 24.22.1 i npm 11.2.0; obie komendy zakończone powodzeniem również na Node 26.7.0. Na Node 26 npm zgłasza ostrzeżenie o wersji, a tsx ostrzeżenie deprecacji.
- `git diff --check`: bez błędów; Git zgłasza jedynie ostrzeżenia o konwersji końców linii.
- Nie wykonano ręcznej kontroli przeglądarki ani telefonu; test nie potwierdza konta, źródła danych, trwałości ani zgodności medycznej.
