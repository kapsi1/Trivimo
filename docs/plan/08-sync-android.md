# Zapis do Health/Connect i opcjonalny Android

M7/M8. Własna baza pozostaje źródłem prawdy, a publikacja do dostawców jest oddzielnym kontrolowanym skutkiem. „Spójne” oznacza zgodne znaczenie i jawnie rozliczone repliki/statusy, nie identyczną zawartość trzech magazynów za wszelką cenę.

## Macierz zapisu przed pierwszą operacją

- [ ] Dla każdego typu i celu określić: create/update/delete, scopes, własność/dostęp do istniejącego rekordu, identyfikator/wersję, ograniczenia czasu/jednostek, rozdzielczość, możliwość odczytu potwierdzenia, wpływ na agregaty i dalszą synchronizację Health↔Connect. Wynik „niewspierane” jest dopuszczalny i widoczny w UI.
- [ ] Sprawdzić rzeczywistą implementację API dla wybranego typu. [Create](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/create) dotyczy identifiable data points i zwraca `Operation`; obsłużyć jej stan/ukończenie oraz odczyt potwierdzenia. Scope write nie gwarantuje edycji dowolnego rekordu ani pochodnej. Roadmapa zapisu wszystkich typów nie jest potwierdzeniem działania.
- [ ] Zacząć od jednego własnego pomiaru wagi lub posiłku, jeśli wspierany, po preview. Nie zaczynać od naprawy cudzych sensorowych kalorii, seryjnego usuwania lub wytwarzania próbek z nocnych średnich.
- [ ] Własne korekty bez możliwości publikacji nadal działają w bazie, z informacją „lokalna korekta, cel nie obsługuje zapisu”. Nie podszywać się pod Fitbit ani zastępować oryginalnej metody/urządzenia cudzymi metadanymi.

## Domena zapisu i kolejka

1. Użytkownik tworzy/edytuje wpis w aplikacji. Zapis lokalny z rewizją, audytem i opcjonalnym zamiarem publikacji jest transakcyjny. Synchronizacja chmury nie blokuje posiadania własnego wpisu.
2. Powstaje trwały outbox z logicznym ID, celem, operacją, wersją wejściową, idempotency key, payload hash i oczekiwanym stanem zewnętrznym.
3. Worker sprawdza uprawnienia/możliwości i ewentualny istniejący rekord. Publikuje, obserwuje operację, odczytuje wynik i dopiero potwierdza zewnętrzne ID/wersję. Stan HTTP 2xx rozpoczynający LRO nie jest końcem publikacji.
4. Po timeout/restart w stanie niepewnym najpierw szuka wyniku poprzedniej operacji. Jeśli brak bezpiecznej zdalnej idempotencji/identyfikacji, nie powiela create, tylko zgłasza niepewność do rozstrzygnięcia.
5. Echo odczytu wiąże się z własną publikacją jako replika. Zmiana treści przez inną aplikację tworzy konflikt/nową wersję, nie automatyczny powrót do starej wartości. Ręczne rozstrzygnięcie ma historię.

- [ ] Polityka konfliktu: własne dane można edytować z expected revision, cudze oryginały zachować; przy rozbieżności pokazać local/remote/base. Nie stosować globalnego „last write wins” po czasie pobrania.
- [ ] Usunięcie lokalne i żądanie usunięcia zewnętrznego rozdzielone. Tombstone nie ginie przed potwierdzeniem/rekonsyliacją. Brak uprawnień nie oznacza, że usunięto chmurę. Usunięcie u dostawcy nie musi od razu usuwać oryginalnego audytu lokalnie; polityka retencji i pełne usunięcie prywatnych danych wymagają jawnego trybu.
- [ ] Nie publikować tego samego zdarzenia dwiema drogami, jeśli Health sam przesyła je do Connect. Wybrać właściciela publikacji per typ, zbadać echo i pochodzenie. Opcjonalny drugi cel tylko z mapowaniem replik i kontrolą braku duplikacji.
- [ ] Kolejka per cel, retry ograniczone, 401/403 wymagają naprawy zgody, konflikt nie jest błędem do nieskończonego ponawiania. UI pokazuje oczekujące, niepewne, potwierdzone i niesynchronizowalne wpisy.

## Co może, a czego nie powinien robić Connect

- [ ] Komponent Android odczytuje/zapisuje przez oficjalne API z uprawnieniami użytkownika. Przeglądarka desktopowa i samo REST Health nie mają bezpośredniego dostępu do lokalnego Connect.
- [ ] Usuwanie/aktualizowanie przez zwykłą aplikację dotyczy jej własnych rekordów w granicach API; nie obiecywać usunięcia cudzych Fit/Fitbit. [HealthConnectClient](https://developer.android.com/reference/kotlin/androidx/health/connect/client/HealthConnectClient). Zbiorcze zarządzanie cudzymi danymi przez UI systemu to osobna czynność użytkownika, nie część adaptera.
- [ ] Wynik samej agregacji bazowej może istnieć bez odpowiadającego zapisanego rekordu. Kasowanie rekordów nie gwarantuje usunięcia takiego wyniku. Nasza aplikacja kwalifikuje dane i pokazuje braki zamiast próbować wymusić dowolny wynik systemowego ekranu.
- [ ] Nie zapisywać nocnego SpO₂ jako wymyślonego pomiaru chwilowego ani całodobowej średniej HRV jako gęstych próbek. Jeśli brak semantycznie wiernego typu, dane pozostają w bazie/API; UI pokazuje powód braku eksportu.
- [ ] Żywienie: wybrać eksport posiłków lub sumy doby, nie obu naraz. Plan ≠ spożycie, nawodnienie osobno. W razie importu tych samych posiłków z innej aplikacji konieczne powiązanie tożsamości przed publikacją.

## Minimalny komponent Android, jeśli uzasadniony

- [ ] Najpierw sprawdzić potrzebę: Connect-only historia, dane innych aplikacji, zapis konkretnego typu lub wygoda telefonu. Jeśli API/Takeout pokrywają potrzeby, nie budować Androida do samego przenoszenia tych samych danych.
- [ ] Kotlin + aktualny Health Connect, progressive permissions, osobno historia/tło i wsparcie typów/feature flags. Zamiast przenosić stare UI Health Sync zacząć od parowania, wyboru typów, preview i statusu zadania.
- [ ] Bezpieczne parowanie z jednym kontem serwera, TLS/auth, klucze w magazynie systemowym, unieważnienie urządzenia. Ręczny plik importowy może być pierwszym wariantem bez otwierania serwera, jeśli wystarczy jednorazowa historia.
- [ ] Transfer odczytów zawiera oryginalne ID/pochodzenie/wersję i chroniony manifest porcji. Serwer deduplikuje i potwierdza cursor dopiero po zapisie. Nie używać ADB i prywatnych endpointów diagnostycznych jako architektury produkcyjnej.
- [ ] Telefon przechowuje minimalny cache/kolejkę z rewizją bazową; nie staje się drugim źródłem prawdy. Polecenia offline dostają idempotency key, konflikt i odczyt potwierdzenia. Rozpoznawać wygaśnięcie tokenów zmian i pełne odzyskanie zakresu.
- [ ] Zadania Android są best-effort, bez obietnicy dokładnej godziny. Wyjaśniać ostatni sukces i ograniczenia tła. Pełny klient mobilny, aparat i mikrofon można dodać później po porównaniu z web/ChatGPT.

## Odbiór

- [ ] Fake adaptery: create/update/delete, LRO pending/error, timeout po skutku, restart, echo obu dróg, zmiana obca, utrata uprawnień, usunięcie i ponowny import. Żadnej pętli ani powtórzonego pomiaru.
- [ ] Realna próba małego wybranego zakresu własnych wpisów, po zgodzie na ten etap; odczyt w aplikacji, API, Health UI i Connect, w zakresie wspieranych celów. Usunięcie próbnych rekordów wyłącznie po sprawdzeniu własności i treści.
- [ ] Raport macierzy: co jest synchronizowane automatycznie, lokalnie skorygowane, oczekujące, niepewne lub niewspierane. Nie deklarować pełnej zgodności tylko dlatego, że odczyt jednej strony zwrócił sukces.
