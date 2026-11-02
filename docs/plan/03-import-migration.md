# Takeout i migracja historii

Zależność M1: własny magazyn oryginałów i reguły sześciu metryk. Import trafia **bezpośrednio do bazy aplikacji**. Nie wymaga telefonu, instalacji Fit ani uprzedniego odtworzenia danych w Connect.

## Odczyt archiwum i sesja importu

- [ ] Użytkownik wskazuje plik/katalog. Nie szukać prywatnych archiwów po komputerze. Dla danych z dotychczasowego projektu używać wyłącznie wskazanego `C:\dev\health-sync\test-data\`; niczego z niego nie kopiować do repo/fixture'ów.
- [ ] ZIP: limity liczby plików, wielkości i współczynnika rozpakowania, streaming, ochrona przed path traversal/symlinkami i nadpisaniem plików. Obsługa wieloczęściowego eksportu z jawnym manifestem, jeśli format tego wymaga; nie udawać kompletności jednej części.
- [ ] Sprawdzić README/nagłówki/schemat i jednostki konkretnego eksportu. Czytnik CSV obsługuje cudzysłowy, przecinki, nowe linie, kodowanie/BOM i puste pola. Nazwa pliku/dzień wygenerowania nie jest czasem pomiaru. Schemat nieznany lub sprzeczny kieruje rekord do kwarantanny z powodem, bez zgadywania kolumn.
- [ ] Archiwum ma digest, konto źródłowe i czas snapshotu. Ten sam użytkownik może mieć wiele eksportów; e-mail/nazwa ZIP nie są jedynym identyfikatorem konta. Metadane konta pozostają prywatne.
- [ ] Preview pokazuje typy, zakres, liczby nowych/zmienionych/powtórzonych/nieobsługiwanych/konfliktowych rekordów, jakość i skutki dla kanonicznych wyników. Osobno „zachowane raw” i „zakwalifikowane”.
- [ ] Zatwierdzony plan zapisuje digest, wersję parsera/reguł, rekordowe ID/hash, rozstrzygnięcia i wykluczenia przed rozpoczęciem zapisu. Wznowienie odtwarza ten plan; zmiana ustawień/priorytetów po zatwierdzeniu nie zmienia go w locie.
- [ ] Checkpoint porcji, zapis raw i unieważnienie wyników transakcyjne. Nowy eksport nie cofa nowszej wersji API bez analizy wersji/semantyki. Powtórny import idempotentny; rekord wykluczony pozostaje w historii decyzji.
- [ ] Zatrzymanie dalszego importu, wznowienie, usunięcie importu i cofnięcie jego wpływu to osobne operacje. Cofnięcie nie usuwa współdzielonego oryginału ani późniejszej korekty użytkownika; najpierw pokaż zależności/projekcje i zachowaj audyt.

## Reguły odziedziczone jako doświadczenie, nie kopia starej ścieżki

- [ ] Zachować ID konkretnego wykluczonego treningu w prywatnej migracji decyzji. Użytkownik wykluczył jeden rekord bieżni i zachował automatyczny spacer; nie usuwać wszystkich bieżni ani wszystkich nakładających się spacerów. Nie utrwalać jego realnego ID w dokumentacji/testach.
- [ ] Sen: połączyć sesję/fazy po źródłowym ID, rozpoznać wersje algorytmu. Jednoznaczne równoważne v1/v2 nie są dwoma snami; stare preferencje v2 zachować jako decyzję historyczną i ponownie zweryfikować dla nowej projekcji. Zachowaj obie wersje raw. Nie rozciągać faz do dopasowania sumy.
- [ ] Ważenia: deduplikować konkretne zdarzenia z tolerancją wynikającą z konwersji precyzji, bez pomijania całego dnia. Nie utożsamiać równej średniej z tym samym zbiorem pomiarów.
- [ ] Aktywność: dzienne/minutowe pliki i legacy tracker summaries to odmienne reprezentacje. Przenieść wszystkie dostępne oryginały, ale nie sumować dziennej wartości z minutową i nie nadawać punktom nieznanych granic przedziału. Historyczny szacunkowy zapis całej doby do Connect nie jest źródłowym rozkładem minutowym.
- [ ] Puste `summary_*` w treningach oznacza brak pola. Serie globalne HR/stref można dopasować po czasie jako osobną analizę z pokryciem; nie udawać źródłowego podsumowania sesji. Nocne podsumowania nie stają się fikcyjnymi punktami pomiaru.

## Historia 2026 i ewentualne źródło Connect

- [ ] Zbudować prywatny raport pokrycia per typ/miesiąc i snapshot źródła. Porównywać tylko wspólny zakończony zakres: starszy Takeout nie ma obowiązku zawierać dni po eksporcie.
- [ ] Kalorie total/active od 2026-01-01 kwalifikować tym samym kontraktem co przyszłe dni. Brak danych Takeout przed rozpoczęciem zapisu typu nie oznacza zera. Nie backfillować active z legacy `activityCalories` bez równoważności.
- [ ] Z doświadczeń Health Sync wynika, że Connect może mieć wcześniejsze pomiary/zdarzenia nieobecne w danym eksporcie. Najpierw ocenić zakres różnic, bez obietnicy, że API uzupełni całość. To argument za opcjonalnym jednorazowym przechwyceniem, nie za obowiązkowym ciągłym Androidem.
- [ ] Jeśli potrzebne, zaprojektować minimalny adapter Connect według [planu Android](08-sync-android.md). Zachować oryginalny `dataOrigin`, device/recordingMethod, czas/offset i rozróżnienie własnych importowanych kopii Health Sync. Nie traktować wszystkiego z pakietu Health Sync jako oryginału Fitbit.
- [ ] Nie wyłączać integracji Google Health↔Connect tylko dlatego, że nowa aplikacja nie czyta Connect. Część danych telefonu może docierać do chmury właśnie tą drogą. Zmiana uprawnień dostawców jest osobną świadomą operacją.
- [ ] Korekta 2026 najpierw mała próbka porównawcza, potem pełny backfill i raport luk. Starsze arkuszowe wyniki zdrowia nie są lepszym źródłem pomiaru niż udokumentowane oryginały.
- [ ] **TODO:** audyt poprzednich lat po M1, z oceną zmian urządzeń, schematów i modeli. Nie rozszerzać automatycznie kwalifikacji 2026 na całą historię.

## Arkusze i zakończenie migracji

Tymczasowy arkusz zdrowia użytkownik dopuścił do zastąpienia/usunięcia. Nie jest już głównym produktem; ewentualny eksport pokazuje tę samą projekcję bazy co UI. Nie usuwać go teraz ani nie utrzymywać starego sync jako zależności MVP. Arkusz posiłków jest odrębnym źródłem z własnymi danymi/formułami: [plan żywienia](06-food-sources.md).

- [ ] Przed wygaszeniem starej aplikacji ocenić, czy zachowano wszystkie potrzebne oryginały i prywatne decyzje. Nie kasować Connect/chmury w celu „wyrównania” źródeł.
- [ ] Testy syntetyczne: kolejne eksporty, zmiana schematu, jednostki, części archiwum, kolizja kont, v1/v2, wykluczenie jednego rekordu, powtórny import, przerwanie, zmiana planu/reguł po preview, usunięcie wpływu importu i ochrona późniejszych korekt.
- [ ] Odbiór: odtworzenie z tych samych raw/wersji daje tę samą projekcję; żadnych podwójnych pomiarów przez transport; raport jasno rozróżnia braki źródła, niekwalifikowane i nieobsługiwane typy.
