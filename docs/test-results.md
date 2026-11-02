# Raport weryfikacji

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
