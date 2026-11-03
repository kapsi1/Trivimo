# Decyzje i granice

## Ustalone przez użytkownika

2026-11-03: dotychczas zaimportowany eksport Google Health pochodzi z jednego konta Google. W aplikacji zapisano wyłącznie lokalny identyfikator i decyzję przypisania, bez adresu e-mail. Dla kolejnych importów nie zakładać automatycznie tego samego konta. Użytkownik potwierdził utworzenie projektu i klienta OAuth; rzeczywista autoryzacja potwierdziła oba zakresy odczytu, natomiast odczyt danych pozostaje do sprawdzenia.

2026-11-03: autoryzacja Google ma przetrwać restart serwera. Zapisywany jest wyłącznie token odświeżania i lista zakresów, zaszyfrowane Windows DPAPI (zakres CurrentUser), w pliku `google-token.dpapi` obok bazy Takeout; przeglądarka nie widzi sekretów, a token dostępu pozostaje w pamięci. Jawne odrzucenie odświeżenia (400/401) usuwa zapis; timeout i 5xx go zachowują. Poza Windows zapis nie działa i autoryzacja zostaje w pamięci. Plik nie jest przenośny między kontami ani komputerami.

2026-11-03: telefon bez opaski również szacuje spalone kalorie. Użytkownik uznał, że takie wartości można porównywać z wartościami z opaski, o ile oznaczone jest źródło szacunku (opaska albo telefon). To zmienia decyzję 5 poniżej w części „dni bez porównywalnych danych opaski pozostają puste": dla kalorii dzień bez opaski nie jest już z góry pusty, ale musi nieść jawne oznaczenie źródła. Sposób ustalania źródła i kwalifikacji pozostaje do wyznaczenia na danych (kandydaci: filtr `google-wearables` w API, tętno z urządzenia opaski, źródło wiersza w Takeout). Użytkownik zgłosił też, że w aplikacji Health widzi spalone kalorie jako wykres godzinowy i oczekuje go w Trivimo.

2026-11-03: ogólna zasada produktu: Trivimo ma udostępniać co najmniej te same dane co aplikacja Health, także szczegółowe serie (np. godzinowe słupki kroków, dystansu i kalorii), a nie tylko sumy dobowe. Rozszerza decyzję 4 o szczegółowość; zakres typów nadal wynika z tego, co API faktycznie udostępnia.

2026-11-03 (zatwierdzone przez użytkownika, wdrożone w wersji 9 magazynu): polityka automatycznych odczytów. (1) Ponowny odczyt o identycznej treści (skrót łańcucha stron dla tego samego rodzaju, konta i zakresu) nie jest zachowywany; wcześniejszy odczyt dostaje znacznik „potwierdzono bez zmian” z czasem i licznikiem. (2) Nowszy odczyt zastępuje starsze automatyczne odczyty tego samego rodzaju i konta, których zakres w całości obejmuje: pośrednie odczyty doby w toku zastępuje od razu najnowszy odczyt tego samego dnia; dla ostatnich trzech zakończonych dób zachowuje się różne wartości (późne korekty), a starsze zastępuje się najnowszym. (3) Każde usunięcie zostawia wiersz audytu (rodzaj, zakres, skrót i czas usuniętego odczytu, odczyt zastępujący, liczba stron, powód). (4) Odczyty ręczne i odczyty innych kont nigdy nie są usuwane; polityka dotyczy tylko zadań rozpoczętych przez odświeżanie automatyczne. Odchodzi to od zasady „zachowuj każdy oryginał” na rzecz „zachowuj najnowszy oryginał każdej doby plus ślad zmian”; sumy dobowe są wtedy zastępowalne, bo nowszy odczyt obejmuje ten sam okres, a dla kalorii, kroków i dystansu szczegółowe okna 10-minutowe są zapisywane osobno.

2026-11-03 (zatwierdzone przez użytkownika, wdrożone w widoku dnia): zamiast dwustanowego „dzień z opaską” pokazywać udział doby z opaską (okna tętna) oraz rozkład aktywnych kalorii na okna z opaską i bez niej; użytkownik nosi opaskę głównie na trening lub spacer, więc próg 50 % doby byłby mylący. Całkowite kalorie pozostają jedną wartością producenta, a ich składnik bazowy nie zależy od źródła.

2026-11-03 (zatwierdzone przez użytkownika, wdrożone jako reguła `google-energy-v1`): kwalifikacja kalorii z danych Google. (1) Kalorie total z okresu 2026-01-01 – ok. 2026-04-07, zapisane przez producenta w kilku długich przedziałach na dobę i bez kalorii aktywnych, są pokazywane jako wartość z uwagą „starszy model źródła”, bo silnie korelują z krokami (wariant B); nie mają rozkładu godzinowego ani składowej aktywnej. (2) Doby z samą energią bazową (stała stawka w oknach, brak kalorii aktywnych) pozostają puste z uwagą „tylko energia bazowa”. (3) Źródło szacunku jest zapisywane w snapshocie jako udział doby z tętnem z opaski oraz podział aktywnych kcal na okna z tętnem i bez, bez progu; tabela pokazuje go w kolumnie „Część dnia z opaską” (zmiana z 2026-11-03: bez dopisku przy wartościach kalorii), a szczegóły komórki opisują źródło szacunku. (4) Zakończona doba odczytana po swoim końcu jest od razu potwierdzona, bez okresu karencji. Bieżąca doba jest „Częściowa” bez uwagi (tabela oznacza ją „w toku”); uwagę „niepełny zakres” ma tylko zakończona doba, której najnowszy odczyt powstał przed jej końcem. (5) Do czasu własnej kwalifikacji masa, tkanka tłuszczowa, kroki i dystans mają w tych snapshotach status „Nieobsługiwane” (domyślnie; użytkownik nie rozstrzygnął jeszcze kroków i dystansu).

2026-11-03 (zatwierdzone przez użytkownika, wdrożone w wersji 10 magazynu): tabela dni ma kolumnę „Źródła” z aplikacjami i urządzeniami, które zapisały kroki i kalorie aktywne danego dnia (lista wpisów API ograniczona do źródła i daty). Zgodnie z życzeniem użytkownika zastępuje ona uwagę „starszy model źródła”: doby starszego modelu kalorii mają wartość bez uwagi, a model zostaje w dowodach snapshotu i w szczegółach komórki. Użytkownik potwierdził, że pomiary tętna z okresu 2026-04-30 – 05-05 to pomiary aparatem telefonu w Google Fit (nie opaska), oraz że po zakupie opaski zmieniał dostępy aplikacji do Health Connect z powodu podwójnego liczenia; przebiegu zmian z kwietnia nie pamięta.

2026-11-03 (zlecone przez użytkownika, wdrożone jako reguła `google-activity-v1`): kroki i dystans w tabeli to wartość dobowa producenta (`dailyRollUp`, `all-sources`). Polityka źródeł opaska/telefon to „uzgodnienie producenta”: na danych 2026 wartość równa się opasce w dobach z opaską, a w pozostałych jednemu źródłu telefonu, i nigdy nie jest sumą kopii (zob. kontrakty). Telefon nie jest wykluczany. Masa i tkanka tłuszczowa pozostają „Nieobsługiwane”.

2026-11-04 (zlecone przez użytkownika, wdrożone jako reguła `google-body-v1`): masa i tkanka tłuszczowa w tabeli to średnia unikalnych pomiarów doby warszawskiej z Google Health API. Takeout nie jest łączony z API: oba mają te same pomiary 2026 (od kwietnia), więc API wystarcza, a Takeout służy do porównania. Kopie tego samego ważenia z różnych aplikacji (Fitbit i Google Fit przez Health Connect) są liczone raz. Wszystkie sześć metryk M1 ma teraz kwalifikację z danych Google.

2026-11-03: BMR nie jest dostępny dla tego konta. W API typ `basal-metabolic-rate` nie istnieje (400), a `basal-energy-burned` obsługuje tylko list/reconcile i zwraca pustą odpowiedź; Takeout nie ma pliku BMR. Różnica total − aktywne nie jest BMR (zmienia się między dobami o kilkadziesiąt procent). Ewentualne wyświetlanie BMR wymaga osobnej, nazwanej i wersjonowanej metryki wyliczanej (np. ze stawki okien bez kroków i bez aktywnych kcal) i decyzji użytkownika.

1. Rozwój Health Sync zostaje wstrzymany. Powstaje nowa aplikacja, teraz jej dokumentacja. Nie migrujemy ani nie usuwamy danych podczas planowania.
2. Własna baza jest źródłem prawdy. API jest głównym bieżącym źródłem Google; Takeout importem historii; własny adapter Connect opcjonalny.
3. Desktop w przeglądarce najpierw, możliwy Android później. UI początkowo prosty i ciemny, z tabelami, wykresami i później mapami/szczegółami.
4. MVP obejmuje sześć metryk wskazanych w README. Docelowo wyświetlamy wszystkie faktycznie odczytywalne typy Health API. Brak dostępu albo pola w API musi być widoczny; nie obiecujemy kopii całego UI Health.
5. Jedna porównywalna definicja kalorii dla historii 2026 i przyszłości. Sam BMR nie trafia do kanonicznego total. Dni bez porównywalnych danych opaski pozostają puste, bez zamiennika telefonu (dla kalorii zmienione 2026-11-03: telefon bez opaski jest dopuszczony przy jawnym oznaczeniu źródła szacunku, zob. wpisy z tej daty powyżej). Nie wymagamy instalacji Google Fit.
6. „Uwagi” obejmują wszystkie metryki. Można zachować surowe wartości do diagnostyki, ale nie prezentować ich jako zakwalifikowanych dziennych pomiarów.
7. Później żywienie/planer, import FatSecret, AI do analizy i wprowadzania, w tym głos/zdjęcia. Zachować możliwość rozmowy w ChatGPT na telefonie i dodania posiłku do aplikacji; nie wymuszać własnego czatu jako jedynej drogi.
8. Edycja i publikacja do Health/Connect są celem, w granicach możliwości i zgodności semantycznej. Własny zapis musi działać także, gdy publikacja nie jest możliwa.
9. Sprawdzenie poprzednich lat pozostaje TODO po walidacji 2026. Wypełnienie każdej luki nie jest warunkiem sukcesu.

Nowe wymaganie pełnego katalogu API zastępuje dla tej aplikacji dawne ograniczenie projektu Health Sync do wybranych pól. Nie przenosimy automatycznie zakazu szczegółowych serii HR ani historycznego wyłączenia sleep score/Profile; ich rzeczywista dostępność wymaga sprawdzenia, bez tworzenia fikcyjnych zamienników.

## Proponowane domyślne decyzje techniczne

Na potrzeby pierwszej próby P0 wybrano TypeScript, React, SQLite i lokalny serwis Node z REST; szczegóły i ograniczenia są w [środowisku developerskim](development.md). Próbę parserów Kotlin należy jeszcze wykonać przed ostateczną oceną stosu. MCP pozostaje przyszłym adapterem tych samych komend.

Kanoniczny dzień: Europe/Warsaw, zachowanie czasu źródła i jawnie osobnych podsumowań cywilnych producenta. Masa/tłuszcz: średnia arytmetyczna unikalnych zaakceptowanych pomiarów dnia; ostatni pomiar dostępny jako osobne pole, bez cichej zamiany znaczenia.

## Decyzje przy właściwym etapie

| Decyzja | Kiedy | Propozycja / co rozstrzygnąć |
| --- | --- | --- |
| Nazwa i identyfikatory produktu | Przed publikacją/klientami OAuth | [Shortlista](names.md); teraz neutralny katalog |
| Stos i wykorzystanie kodu Kotlin | P0 | Mała próba parsera i testów; nie budować mostu JVM bez potrzeby |
| Konto i projekt OAuth | Przed realnym odczytem M1 | Nowa tożsamość aplikacji; minimalne read-only, testowy użytkownik |
| Model kalorii i progi kwalifikacji | M1 przed backfill | Ocena kilku dni API/Takeout; nie zgadywać czasu noszenia ani progu kompletności |
| Zdalny dostęp i stale dostępny serwer | Przed mobilnym wpisywaniem/MCP | Prywatny host/tunel lub serwer; osobny wybór kosztów, dostępności i prywatności |
| Wariant ChatGPT Android | Spike w AI | Potwierdzić konkretne konto, klienta, głos/zdjęcia, odczyt/zapis i wyłączenie PC |
| Polityka AI i koszty | Przed wywołaniami modeli | Dostawca/model i dane wysyłane, limity; brak sztywnego modelu w domenie |
| Mapy i licencje katalogów żywności | Przed ich adapterami | Dostawca, limity, atrybucja, przechowywanie i eksport |
| Pierwszy zapis zewnętrzny | M7 | Najpierw własny pomiar wagi lub posiłek; osobne mapowanie per cel |
| Rola obecnego arkusza posiłków | Przed migracją żywienia | Import lub okres przejściowy z jednym właścicielem; zachować oryginał |

Brak decyzji o żywieniu, mapach, serwerze zdalnym lub nazwie nie blokuje lokalnego MVP. Niedostępność OAuth nie blokuje pracy na syntetycznych danych i parserze, ale MVP integracyjnego nie wolno wtedy ogłosić ukończonym.
