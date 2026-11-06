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
- [ ] UI: ładowanie/empty/error/stale, ciemny motyw i kontrast, klawiatura, długie tabele, duże serie, brak map/LLM i polskie jednostki/daty (telefon: [plan 10](10-mobile.md)). Testy danych w UI odwołują się do definicji domeny, bez drugiego niezależnego algorytmu sum.

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

## Interfejs: eksport i kopia z UI (przeniesione z M1)

Przeniesione z [planu MVP](01-foundation-mvp.md) 2026-11-06 (decyzja użytkownika); nie blokują M1. Sprawdzenie widoku na telefonie: [plan 10](10-mobile.md).

- [ ] Eksport CSV wybranej projekcji (przycisk usunięto z tabeli do czasu wdrożenia): zabezpieczenie przed formułami (CSV/formula injection), zachowanie jednostek i statusów (brak, zero, nieporównywalne, konflikt), nazwa pliku bez danych prywatnych, wersja reguł w nagłówku.
- [ ] Kopia zapasowa z interfejsu (Ustawienia pokazują dziś polecenia CLI) oraz historia importów i dziennik zdarzeń w „Źródłach danych”. Wymagają nowych punktów API: kopia przez wspierany mechanizm SQLite backup do wskazanego katalogu poza repozytorium (jak `backup:takeout`), z weryfikacją po zapisie; dziennik tylko z kodów i liczb, bez wartości i identyfikatorów.

## Przegląd nieużywanych danych (po M6)

Wykonać dopiero, gdy znamy wszystkich konsumentów danych, czyli po: pełnym katalogu API i raporcie pokrycia (M2, [plan 02](02-health-api.md)), typach żywienia czytanych z API (M3), wpisach i analizach AI korzystających z danych (M5–M6, [plan 07](07-ai-chatgpt.md)). Wcześniej przegląd byłby niepełny i mógłby uznać za zbędne dane potrzebne późniejszym etapom. Zapisy do Health/Connect i opcjonalny Android ([plan 08](08-sync-android.md), M7–M8) liczą się jako konsumenci odczytów kontrolnych po zapisie; przegląd powtórzyć po M7, a po M8 tylko jeśli komponent powstanie.

- [ ] Sprawdzić, czy pobieramy z API albo zapisujemy w bazie dane, których aplikacja nie używa (pola odpowiedzi, typy, strony, zakresy, kolumny i tabele, wartości pochodne, kopie surowych odpowiedzi). Dla każdej pozycji: skąd pochodzi, czy ją czyta UI, REST, MCP, projekcja, rekonsyliacja, import, analiza AI, kopia lub zapis zewnętrzny, jaki ma rozmiar i koszt (żądania, miejsce), oraz wynik: zostaje (z przyczyną), przestajemy pobierać/zapisywać albo wymaga decyzji użytkownika.
- [ ] Nie usuwać automatycznie. Oryginały i dane potrzebne do odtworzenia, korekt lub kontraktów ([dane](../data-contracts.md)) zostają; usunięcie istniejących zapisów jest osobną operacją z podglądem zależności i kopią (zob. czyszczenie cache, raw i historii w sekcji „Kopie, odtwarzanie i eksploatacja”).
- [ ] Wynik zapisać jako listę w docs bez wartości zdrowotnych, identyfikatorów i tokenów; raport z wartościami poza repozytorium. Po przeglądzie dodawać pytanie „kto to czyta?” do karty każdego nowego typu danych.

## Raportowanie

Komendy: [środowisko](../development.md); wyniki: [raport testów](../test-results.md) z datą, komendą, wynikiem i ograniczeniami. Wyniki Gradle z Health Sync nie są dowodem dla tej aplikacji.
