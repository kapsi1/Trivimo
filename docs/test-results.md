# Raport weryfikacji

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
