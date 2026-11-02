# Decyzje i granice

## Ustalone przez użytkownika

1. Rozwój Health Sync zostaje wstrzymany. Powstaje nowa aplikacja, teraz jej dokumentacja. Nie migrujemy ani nie usuwamy danych podczas planowania.
2. Własna baza jest źródłem prawdy. API jest głównym bieżącym źródłem Google; Takeout importem historii; własny adapter Connect opcjonalny.
3. Desktop w przeglądarce najpierw, możliwy Android później. UI początkowo prosty i ciemny, z tabelami, wykresami i później mapami/szczegółami.
4. MVP obejmuje sześć metryk wskazanych w README. Docelowo wyświetlamy wszystkie faktycznie odczytywalne typy Health API. Brak dostępu albo pola w API musi być widoczny; nie obiecujemy kopii całego UI Health.
5. Jedna porównywalna definicja kalorii dla historii 2026 i przyszłości. Sam BMR nie trafia do kanonicznego total. Dni bez porównywalnych danych opaski pozostają puste, bez zamiennika telefonu. Nie wymagamy instalacji Google Fit.
6. „Uwagi” obejmują wszystkie metryki. Można zachować surowe wartości do diagnostyki, ale nie prezentować ich jako zakwalifikowanych dziennych pomiarów.
7. Później żywienie/planer, import FatSecret, AI do analizy i wprowadzania, w tym głos/zdjęcia. Zachować możliwość rozmowy w ChatGPT na telefonie i dodania posiłku do aplikacji; nie wymuszać własnego czatu jako jedynej drogi.
8. Edycja i publikacja do Health/Connect są celem, w granicach możliwości i zgodności semantycznej. Własny zapis musi działać także, gdy publikacja nie jest możliwa.
9. Sprawdzenie poprzednich lat pozostaje TODO po walidacji 2026. Wypełnienie każdej luki nie jest warunkiem sukcesu.

Nowe wymaganie pełnego katalogu API zastępuje dla tej aplikacji dawne ograniczenie projektu Health Sync do wybranych pól. Nie przenosimy automatycznie zakazu szczegółowych serii HR ani historycznego wyłączenia sleep score/Profile; ich rzeczywista dostępność wymaga sprawdzenia, bez tworzenia fikcyjnych zamienników.

## Proponowane domyślne decyzje techniczne

To propozycje do zatwierdzenia w P0, nie wymagania użytkownika: TypeScript dla domeny/serwera/web, React, SQLite, jeden serwis i proces roboczy; szczegóły w [architekturze](architecture.md). Lokalny serwis na komputerze dla pierwszego MVP. REST jako stabilna granica przypadków użycia; MCP później jako adapter do tych samych komend.

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
