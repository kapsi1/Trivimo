# Jakość, prywatność i utrzymanie

Wymagania przekrojowe od P0. Dobierać testy do ryzyka i wpływu; nie tworzyć testów odtwarzających implementację ani uruchamiać pełnych drogich zestawów po każdej korekcie tekstu.

## Bezpieczeństwo i dane prywatne

- [ ] Serwis lokalny: loopback, sesja `SameSite=Strict`, kontrola Host/Origin i nagłówek żądania dla POST już działają (zob. [środowisko](../development.md#rest)); loopback nie chroni przed lokalnymi programami. Dostęp spoza komputera wymaga wybranego modelu TLS/auth; nie otwierać portu na 0.0.0.0 bez decyzji wdrożeniowej.
- [ ] Tokeny i klucze w systemowym/serwerowym secret store (token Google: DPAPI), oddzielone od DB dostępnej UI. Nie umieszczać w localStorage, kodzie bundla, URL, logach, nazwach eksportów ani promptach. Google OAuth, sesja aplikacji i autoryzacja MCP są różnymi relacjami.
- [ ] Prywatny katalog danych poza repo, restrykcyjne prawa OS, szyfrowanie dysku i chronione kopie. Osobne zasady dla dużych oryginałów, tras, audio i zdjęć. Szyfrowanie pliku bazy, jeśli potrzebne, z wybranym mechanizmem zarządzania kluczem; nie obiecywać go przez samo użycie SQLite.
- [ ] Domyślnie bez zewnętrznej analityki i wysyłania pomiarów do raportowania błędów. Logi: kod błędu, typ operacji, lokalne niejawne correlation ID i postęp; bez payloadów, route bounds, identyfikatorów kont i tokenów. Debug z prywatnymi danymi tylko świadomie, poza repo i z retencją.
- [ ] Importowane pliki, wyniki modeli i strony produktów niezaufane. Limity ZIP/XML/obrazów/audio/JSON, walidacja jednostek i czasu, odrzucanie nieobsługiwanych treści. Prompt injection nie może zmienić uprawnień ani wykonać arbitralnego URL/SQL. Eksport tabel chroniony przed CSV/formula injection.
- [ ] AI, mapy i katalogi mają jawny przepływ danych, minimalny zakres i osobne ustawienia. Usunięcie z aplikacji wyjaśnia, co pozostaje u dostawcy i w kopiach; nie deklarować kasowania chmury bez potwierdzenia.

## Testy domeny i adapterów

- [ ] Jednostkowe: przeliczenia, int64/precyzja, null/zero, semantyka energii, wiele pomiarów dnia, fazy snu/strefy, DST/podróże, pokrycie i wersje definicji. Fixture'y wyłącznie syntetyczne.
- [ ] Własności/metamorphic: wynik nie zależy od kolejności i powtórzenia importu, wielkości porcji i pozycji dnia w zakresie; replikacja nie zwiększa sumy; zmiana prezentacyjnego zaokrąglenia nie zmienia danych; restart daje tę samą zatwierdzoną decyzję.
- [ ] Adaptery HTTP fake: paginacja, 429/5xx/401/403, ograniczenia zakresu, wygaśnięcie tokena, częściowa odpowiedź, zmiana schematu, nieznany enum i brak wsparcia typu. Częściowy sukces nie potwierdza kompletnego checkpointu.
- [ ] DB: migracja na kopii, transakcja checkpoint+records, rewizja wynik+uwagi, outbox i uncertain writes, odzyskanie po przerwaniu i konflikt dwóch klientów. Sprawdzić nieutracenie korekty po aktualizacji raw.
- [ ] UI: ładowanie/empty/error/stale, ciemny motyw i kontrast, klawiatura, długie tabele, duże serie, brak map/LLM, mobile form i polskie jednostki/daty. Testy danych w UI odwołują się do definicji domeny, bez drugiego niezależnego algorytmu sum.

## Weryfikacja prawdziwych źródeł

- [ ] Najpierw ograniczony read-only zakres i porównanie tych samych dat, definicji, offsetów i dat snapshotów. Potem większa historia. Nie wnioskować o równości Health UI/API/Takeout tylko z nazwy pola.
- [ ] Zanotować prywatnie zakres prób i rozbieżności, a publicznie w docs tylko definicje i ograniczenia, bez pomiarów/tras. Test automatyczny nie dowodzi dostępności konta ani działania telefonu.
- [ ] Zapisy zewnętrzne dopiero w ich etapie, po sprawdzeniu macierzy i podglądzie konkretnego własnego wpisu. Oddzielić dowód API, widoku Health i Connect oraz uwzględnić opóźnienie dostawcy.
- [ ] Odbiór ChatGPT na telefonie jest odrębny od testu MCP/API desktop. Próba z wyłączonym hostem musi mieć oczekiwany stan i instrukcję odzyskania, bez pozornego sukcesu.

## Kopie, odtwarzanie i eksploatacja

- [ ] Spójna kopia bazy oraz manifestu plików, wersji kontraktów i decyzji importu. SQLite przez wspierany mechanizm backup/checkpoint, nie przypadkowe kopiowanie otwartego pliku bez WAL. Zaszyfrowana kopia poza tym samym dyskiem; zasady kluczy i retencji.
- [ ] Odtworzyć w pustym katalogu: rekordy, wersje, receptury, załączniki, projekcje i niedokończone zadania. Po restore wstrzymać niepewne publikacje do uzgodnienia zdalnego stanu, zamiast odtworzyć stare create i podwoić dane.
- [ ] Migracje wersjonowane, kopia przed zmianą schematu i test na syntetycznej bazie starej wersji. Zmiana kontraktu może wymagać lokalnego przeliczenia/backfill; nie przepisywać historii przez zmianę nazwy kolumny.
- [ ] Status operacyjny: ostatni sukces i zakres per adapter, kolejki, budżety i błędy możliwe do naprawienia. Eksport danych użytkownika w udokumentowanym formacie; osobne czyszczenie cache, raw, historii i konta z podglądem zależności.
- [ ] Zmierzyć wielkość raw/serii/załączników, czas importu 2026 i render dużej tabeli na środowisku docelowym. Wydajność poprawiać według pomiaru: indeksy, batch, decymacja do wykresu; nie usuwać oryginałów po cichu.

## Strefy czasowe

- [ ] Strefy czasowe: dziś doba, tydzień i zmiana czasu są liczone wyłącznie w `Europe/Warsaw`. Dodać strefę jako ustawienie użytkownika (domyślnie Warszawa), a granice doby, okna 10-minutowe, „dziś”, prognozę i etykiety godzin liczyć w wybranej strefie. Zmiana znaczenia doby wymaga wersji reguły i migracji (zasada z `data-contracts.md`): wyniki dobowe zapisane dla poprzedniej strefy nie mogą się po cichu przesunąć, a przeliczenie ma być jawną operacją z zachowaniem oryginałów i historii. Do rozstrzygnięcia: jedna strefa globalna, czy strefa przypisana do doby (podróże: doba zapisana tam, gdzie była mierzona; Google zapisuje czas cywilny pomiaru). Testy: strefy bez i z DST oraz o innych przesunięciach (np. UTC, Nowy Jork, Kolkata o +5:30), doba 23/25 godzin w obu półkulach, granica doby przy zmianie strefy w trakcie podróży, niezależność wyniku od porcji importu.
- [ ] Teksty o strefie w interfejsie i dokumentacji: zastąpić sformułowania „doba warszawska”, „dzień warszawski”, „doby warszawskiej”, „w Warszawie”, „Data w Warszawie” i „Europe/Warsaw” (interfejs: Źródła danych, Tabela dni, Import CSV, Ustawienia; dokumentacja: `data-contracts.md`, `decisions.md`, `architecture.md`, `development.md`, `test-results.md`) neutralnym określeniem „doba” razem ze strefą wybraną w ustawieniach (np. „doba w strefie Europe/Warsaw” tylko tam, gdzie strefa jest istotna). Wykonać razem z obsługą stref: przed nią tekst „doba” bez strefy byłby mylący dla jedynej obsługiwanej strefy. Wpisy historyczne w `test-results.md` i `decisions.md` zachować z datą; poprawiać tylko opisy obowiązujących reguł i teksty widoczne dla użytkownika.

## Raportowanie

Komendy: [środowisko](../development.md); wyniki: [raport testów](../test-results.md) z datą, komendą, wynikiem i ograniczeniami. Wyniki Gradle z Health Sync nie są dowodem dla tej aplikacji.
