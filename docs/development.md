# Środowisko developerskie

Projekt używa TypeScript, React i Vite, Node 26 LTS od wersji 26.13 lub Node 24 LTS, wbudowanego `node:sqlite`, npm, Zod oraz test runnera Node przez tsx. Wersje bibliotek przypięto w `package.json` i `package-lock.json`. API nasłuchuje wyłącznie na 127.0.0.1. Interfejs (`apps/web`) realizuje [projekt UI](design/ui.md); kroje pisma są lokalnymi plikami w `apps/web/src/fonts` (SIL OFL), więc strona nie łączy się z Google Fonts.

W systemie Windows można uruchomić `start-trivimo.cmd` poza środowiskiem izolowanym. Skrypt uruchamia serwer i interfejs w tle; stronę otwiera się pod `http://localhost:5173/`. Jeśli port jest zajęty, zgłasza problem i nie zatrzymuje innych procesów.

Alternatywnie w PowerShell, po zainstalowaniu obsługiwanej wersji Node:

```powershell
npm ci
npm run dev
```

W drugim terminalu w tym samym katalogu:

```powershell
npm run dev:web
```

Otwórz adres podany przez Vite; widok startowy to „Dzień”. Oryginalne wiersze Takeout są w „Źródła danych” → „Importy plików”. Tam też można wkleić pełną ścieżkę rozpakowanego katalogu, sprawdzić podgląd i potwierdzić zapis; polecenia terminalowe poniżej pozostają alternatywą. Widok pokazuje oryginał i, dla znanych jednostek, dokładne przeliczenie bez kwalifikacji pomiaru. Filtr daty odnosi się do tekstu czasu w źródle, nie do doby Europe/Warsaw. `npm test` uruchamia testy syntetyczne, `npm run typecheck` sprawdza typy, a `npm run build` sprawdza typy i buduje interfejs.

Schemat przykładu ma wersję `user_version = 1` i powstaje w transakcji. Test sprawdza również syntetyczną bazę plikową, jej ponowne otwarcie oraz kopię przez SQLite backup API i odtworzenie do nowego pliku. Dane przykładowe pozostają w pamięci; magazyn importu jest osobnym plikiem. Funkcja kopii nie jest jeszcze podłączona do migracji i nie obejmuje załączników, szyfrowania ani polityki retencji; nie jest gotowym rozwiązaniem kopii danych zdrowia.

API sprawdza Host i Origin dla lokalnego adresu oraz Vite na porcie 5173, a dostęp wymaga lokalnego ciasteczka sesji `HttpOnly`/`SameSite=Strict`. Import przez UI wymaga dodatkowo jawnego Origin, nagłówka żądania oraz potwierdzenia przygotowanego planu. Nie ma jeszcze modelu dostępu zdalnego; nie udostępniaj serwisu w sieci. Wykres przykładu prezentuje abstrakcyjne wartości, nie metrykę medyczną.

## Lokalny import Takeout

Eksport Takeout do pracy deweloperskiej znajduje się w katalogu `test-data/` w repozytorium (pominięty przez `.gitignore`). Zasady odczytu rzeczywistych wartości opisuje [plan](plan/README.md#dane-rzeczywiste-w-pracy-deweloperskiej).

Wskaż tylko wybrany, rozpakowany katalog eksportu. Bez wyszukiwania archiwów na dysku:

```powershell
npm run preview:takeout -- "C:\sciezka\do\eksportu"
npm run import:takeout -- "C:\sciezka\do\eksportu"
npm run verify:takeout
npm run verify:takeout -- "C:\chroniony-katalog\kopia.sqlite"
npm run backup:takeout -- "C:\chroniony-katalog\kopia.sqlite"
```

Na czas importu z terminala zamknij serwer; import w interfejsie wykonuje ten sam serwis. Import zachowuje pliki z katalogu Google Health; dla sześciu typów MVP dodatkowo odczytuje pola CSV i udostępnia ich surowy widok. Pozostałe pliki zachowuje bez interpretacji. Przed zapisem tworzy podgląd i trwały plan ze skrótami, zapisuje oryginalne bajty oraz pola jako tekst, zatwierdza każdy plik z checkpointem i wznawia niedokończony plan tylko przy niezmienionym pliku. Powtórzenie identycznych plików nie duplikuje ich treści. Wiersz jest pozycją w oryginalnym pliku, nie ustalonym ID pomiaru; różne pliki mogą zawierać kopie. Nie wylicza ani nie kwalifikuje wyników dziennych.

Magazyn `%LOCALAPPDATA%\Trivimo\takeout-raw.sqlite` jest poza repozytorium i nie jest szyfrowany przez aplikację. Polega na uprawnieniach i ochronie dysku systemu; nie ma jeszcze kompletnego mechanizmu szyfrowanych kopii. `verify:takeout` sprawdza integralność bazy, skróty oryginałów i liczbę zapisanych wierszy, nie zgodność znaczenia z Google Health. Rozpoznawane CSV wymagają UTF-8, maksymalnie 200 000 wierszy, 256 kolumn i 65 536 znaków na rekord; każdy plik jest ograniczony do 32 MiB, a cały plan do 5 000 plików. Import nie rozpakowuje ZIP i pomija napotkane linki symboliczne. Do większych eksportów potrzebne jest strumieniowanie i dalsza obsługa limitów.

Serwer oraz polecenia importu, weryfikacji i kopii używają tego samego katalogu. Opcjonalna zmienna `TRIVIMO_DATA_DIR` wskazuje katalog zawierający `takeout-raw.sqlite`. Jeśli środowisko izolowane nie ma dostępu do właściwej bazy, uruchom serwer w zwykłym terminalu użytkownika; przycisk „Spróbuj ponownie” ponawia odczyt bez restartu, gdy plik stanie się dostępny.

Odtworzenie sprawdza `npm run verify:restore -- "D:\chroniony-katalog\kopia.sqlite"`: kopiuje zamkniętą kopię do pustego katalogu tymczasowego, porównuje skróty, sprawdza integralność, oryginały, łańcuchy stron Google i snapshoty, uruchamia odczyty tabeli (źródła, część dnia z opaską) i przebudowuje projekcję dób z oryginałów, która musi być równa opublikowanym snapshotom; wypisuje tylko liczby i daty. Kopia nie zawiera tokenu Google (`google-token.dpapi` jest związany z kontem Windows), więc po odtworzeniu na innym koncie lub komputerze trzeba ponownie autoryzować aplikację; pliku `.env` i klienta OAuth też nie obejmuje.

Polecenie kopii korzysta z SQLite backup API, wymaga nowej nazwy i nie nadpisuje istniejącego pliku; tworzy nieszyfrowaną kopię samej bazy. Wymaga docelowego systemu plików obsługującego dowiązania twarde. Wybierz odpowiednio chronioną lokalizację. Mechanizm kopii i odtwarzanie sprawdzono na syntetycznej bazie; wykonano i zweryfikowano także prywatną kopię w lokalizacji wskazanej przez użytkownika.

Opcjonalna próba starych parserów: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/spike-takeout.ps1`. Wymaga sąsiedniego kodu `C:\dev\health-sync`, lokalnego cache Gradle z Kotlin 2.0.21 i wskazanej w skrypcie Javy Android Studio. Test używa wyłącznie syntetycznych ciągów; nie jest częścią CI ani importem. Lokalny launcher obchodzi niezgodność rozpoznania JDK 25 przez starszy kompilator, bez zmiany JDK ani starego projektu.

## Import CSV z mapowaniem kolumn

„Źródła danych” → „Importy plików” → „Import CSV z mapowaniem kolumn”: wybierz plik w przeglądarce (UTF-8, do 8 MiB), sprawdź pierwsze wiersze i zaproponowane mapowanie (kolumna i format daty, opcjonalna godzina, kolumna i jednostka każdej metryki, separator dziesiętny, znaczenie kilku wierszy jednej doby), przygotuj podgląd, a potem potwierdź zapis. Podgląd podaje liczby wartości, pustych komórek i odrzuceń (z numerami wierszy) oraz ile dób metryka uzupełni, a w ilu zostanie wartość Google. Token podglądu wiąże dokładny tekst pliku, mapowanie i wersję parsera; zmiana któregokolwiek wymaga nowego podglądu. Lista pod formularzem pozwala wykluczyć import z tabeli i go przywrócić. Reguły: [`csv-fill-v1`](data-contracts.md#reguła-csv-fill-v1--import-csv-z-mapowaniem-2026-11-04). REST: `POST /api/csv/inspect`, `/api/csv/preview`, `/api/csv/import`, `/api/csv/decision`, `GET /api/csv/imports` (sesja lokalna, POST z `X-Trivimo-Request`).

Import CSV wymaga magazynu w wersji 11. Przy zatrzymanym serwerze: `npm run migrate:canonical -- <nowa ścieżka kopii poza repozytorium>`; bez migracji serwer, odświeżanie Google i import zgłaszają „wymaga migracji”.

## Środowisko lokalne użytkownika (stan 2026-11-03)

- Baza aplikacji: `%LOCALAPPDATA%\Trivimo\takeout-raw.sqlite`, obok niej `google-token.dpapi`. Kopie przed migracjami (jedna na wersję) leżą na dysku D: w katalogu `Trivimo-bak`; `npm run migrate:canonical -- <nowa ścieżka kopii>` wykonuje jeden krok (wersje 5→11 przeszły, ostatnia 2026-11-04; kolejną dopisz w `apps/server/migrate-canonical.ts`). Kopię trzeba wskazać poza katalogiem repozytorium i nowej nazwy; migrację uruchamiaj przy zatrzymanym serwerze albo ostrożnie, bo kod serwera sprawdza dokładną wersję magazynu.
- Eksport Takeout do pracy: `test-data/` w repozytorium (poza gitem). Plik klienta OAuth jest w prywatnym katalogu poza repozytorium; jego ścieżkę poda użytkownik (zmienna `TRIVIMO_GOOGLE_CLIENT_FILE`), nie zapisuj jej ani zawartości w docs.
- Skrypt `npm run google:read` czyta zakres przez ten sam kod co panel i wypisuje tylko status; służy też agentowi do odczytu bez przekazywania sekretów do kontekstu.
- Punkty REST dla widoku dnia i tabeli: `/api/google/daily-candidates`, `/api/google/band-share`, `/api/google/band-share-range`, `/api/google/day-series`, `/api/google/day-sources`, `/api/google/heart-rate` (okna tętna doby), `/api/google/heart-rate-range` (tętno dób), `/api/google/energy-forecast` (prognoza doby w toku), `/api/google/coverage` (kalendarz pokrycia), `/api/google/sync-status`, `POST /api/google/sync`, `/api/google/jobs`. Wszystkie wymagają sesji lokalnej, a POST dodatkowo nagłówka `X-Trivimo-Request`.
- Jednorazowe skrypty analizy Takeout/API nie są w repozytorium; ich wnioski są w [kontraktach](data-contracts.md) jako reguły bez wartości.

## Autoryzacja Google Health — próba lokalna

Dodaj w kliencie OAuth typu aplikacja internetowa dokładny autoryzowany adres przekierowania `http://127.0.0.1:3000/api/google/callback`. Plik JSON klienta Google zachowaj w prywatnym miejscu poza repozytorium. Uruchom serwer z lokalną zmienną wskazującą ten plik (w tym samym terminalu):

```powershell
$env:TRIVIMO_GOOGLE_CLIENT_FILE = 'C:\prywatny-katalog\client_secret.json'
npm run dev
```

Zamiast ustawiać zmienne w każdym terminalu, skopiuj `.env.example` do `.env` w katalogu projektu i uzupełnij `TRIVIMO_GOOGLE_CLIENT_FILE` (opcjonalnie `TRIVIMO_GOOGLE_SYNC_MINUTES` i `TRIVIMO_DATA_DIR`). Plik `.env` jest poza gitem i wczytują go serwer (`npm run dev`, `start-trivimo.cmd`) oraz skrypty `google:read`, `import:takeout`, `verify:takeout`, `backup:takeout`, `migrate:canonical` i `verify:restore`. Zmienna ustawiona w terminalu ma pierwszeństwo przed plikiem. Ścieżki Windows wpisuj bez cudzysłowu, w apostrofach albo z `/`; w cudzysłowie podwójnym parser Node zamienia `\n` na nową linię. W `.env` są tylko ścieżki i ustawienia; sekret klienta zostaje w pliku JSON poza repozytorium.

W drugim terminalu uruchom `npm run dev:web`. Na stronie wybierz „Źródła danych” → „Połączenia” → „Autoryzuj konto Google”. Po zgodzie wróć do aplikacji i odśwież widok. Serwer musi działać na porcie 3000. Nie umieszczaj pliku ani sekretów w repozytorium.

Token dostępu istnieje tylko w pamięci serwera. Token odświeżania jest zapisywany w `google-token.dpapi` obok bazy Takeout, zaszyfrowany Windows DPAPI (CurrentUser); po restarcie i po wygaśnięciu tokenu dostępnego serwer odnawia go automatycznie, a odrzucenie przez Google usuwa zapis i wymaga ponownej autoryzacji. Po autoryzacji przeglądarka wraca na adres, z którego ją rozpoczęto. Odłączanie/uprawnienia oraz pełny odczyt danych Google nie są jeszcze wdrożone; automatyczne odświeżanie i zapis sprawdzono testami z syntetycznym magazynem i szyfrowaniem DPAPI na wartości testowej, nie z prawdziwym kontem. Częściowa zgoda nie jest pełnym dostępem; ekran podaje liczbę przyznanych zakresów. Autoryzację dwóch zakresów sprawdzono na koncie użytkownika; wykonano ograniczony odczyt jednej strony wagi, bez analizy jej wartości.

Odświeżanie bieżących dni (kroki, dystans, kalorie total i aktywne oraz okna 10-minutowe tętna i aktywnych kalorii) działa w procesie serwera i jest konfigurowane osobno od otwierania interfejsu: ustaw `TRIVIMO_GOOGLE_SYNC_MINUTES` (liczba całkowita od 15 do 1440) przed `npm run dev`, żeby serwer odświeżał automatycznie przy starcie i co tyle minut. Bez zmiennej działa tylko przycisk „Odśwież teraz” w sekcji Google. Każdy przebieg najpierw wznawia niedokończone zadania zapisanymi kursorami, potem czyta dzisiejszą dobę oraz raz trzy ostatnie zakończone doby; po przerwie w działaniu serwera dochodzą dni od ostatniego odczytu, najwyżej 13. Dłuższa przerwa zostaje widoczna jako brak pokrycia w stanie odświeżania, a nie jest zgadywana. Przebieg zatrzymuje się na pierwszym błędzie i nie ponawia go natychmiast; stan pokazuje tylko kody błędów. Odczyty automatyczne podlegają polityce z [decyzji](decisions.md): identyczny ponowny odczyt nie jest zachowywany (wcześniejszy dostaje znacznik potwierdzenia), nowszy odczyt zastępuje pośrednie odczyty doby w toku, dla ostatnich trzech zakończonych dób zachowywane są różne wartości, a każde usunięcie zostawia wiersz audytu; odczyty ręczne (`npm run google:read`, panel) nie są usuwane, więc ich się nie powtarza bez potrzeby. Gdy po przebiegu automatycznym zostają nieodczytane zakończone doby od 2026-01-01 (przerwa dłuższa niż 13 dni albo nowy rodzaj odczytu), serwer sam uruchamia uzupełnianie historii; po ręcznym zatrzymaniu nie wznawia go do restartu serwera. Minioną dobę 2026 bez żadnego odczytu tabela dni oznacza uwagą o przerwie. Przy dzisiejszej dobie odczyt okien 10-minutowych to ok. 20–30 kB na rodzaj. Ręczny odczyt dowolnego zakresu: `npm run google:read -- <rodzaj> <od> <do>`.

Uzupełnianie historii (panel „Uzupełnianie historii”, `POST /api/google/backfill` z `{"action":"start"}` (opcjonalnie `"from":"RRRR-MM-DD"`, najwcześniej 2000-01-01) albo `{"action":"stop"}`, stan w `GET /api/google/sync-status` w polu `backfill`) czyta te same rodzaje co odświeżanie (od wersji 10 także listy źródeł kroków i kalorii aktywnych) od 2026-01-01, a na żądanie od wybranej wcześniejszej daty, do wczoraj. Doby sprzed okna przeliczania odświeżania (ostatni rok od 2026) dostają snapshoty po zakończeniu albo zatrzymaniu przebiegu. Kalendarz pokrycia przyjmuje rok: `GET /api/google/coverage?year=2024`. Doba jest pokryta, gdy dowolny pełny odczyt tego rodzaju (ręczny, automatyczny albo z uzupełniania) objął ją w całości po jej zakończeniu; doba odczytana w toku nie jest pokryta. Niepokryte doby są dzielone na kolejne paczki: 13 dób dla okien 10-minutowych, 14 dla kalorii total, 7 dla list źródeł, 30 dla masy i tkanki tłuszczowej, 90 dla pozostałych sum. Pojedyncze żądanie jest ponawiane przy 429 i przejściowym 503 (do 4 prób, `Retry-After` albo rosnący odstęp); trwałe 503 kończy przebieg kodem błędu bez wstrzymywania kolejnych, a ponowne uruchomienie kontynuuje od brakujących dób. Postęp jest liczony z bazy, więc przeżywa odświeżenie strony, zamknięcie karty i restart serwera; sam przebieg działa w procesie serwera i po jego restarcie trzeba go wznowić przyciskiem. Uzupełnianie dzieli z odświeżaniem blokadę, ponowienia przy 429 i wstrzymanie po trwałym 429 (wtedy czeka i kontynuuje). Zatrzymanie kończy pracę po bieżącej paczce i niczego nie cofa. Odczyty uzupełniania są automatyczne w rozumieniu polityki odczytów, więc mogą zastąpić starsze odczyty automatyczne zawarte w ich zakresie (z audytem).
