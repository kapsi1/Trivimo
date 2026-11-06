# Takeout i migracja historii

Zależność M1: własny magazyn oryginałów i reguły sześciu metryk. Import trafia **bezpośrednio do bazy aplikacji**. Nie wymaga telefonu, instalacji Fit ani uprzedniego odtworzenia danych w Connect.

## Odczyt archiwum i sesja importu

Wykonane: import katalogu i plików ZIP Takeout do bazy (zachowane bajty, surowe wiersze sześciu typów, podgląd, zamrożony plan, checkpoint i wznowienie per plik), przypisanie importów do lokalnego konta po potwierdzeniu użytkownika, import CSV z mapowaniem (`csv-fill-v1`). Opis: [środowisko](../development.md#importy-plików).

- [ ] ZIP: sprawdzenie na prawdziwym archiwum z Takeout (dotąd archiwum utworzone lokalnie z tych samych plików) i manifest części — import kilku części nie sprawdza, czy wybrano wszystkie.
- [ ] CSV z mapowaniem: próba na rzeczywistym pliku użytkownika, podgląd wartości przed zapisem (dziś liczby i odrzucenia), strumieniowanie plików > 8 MiB.
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

## Historia i ewentualne źródło Connect

Historia 2026 z API jest uzupełniona i zakwalifikowana regułami M1 ([M1 — wykonane](../completed/02-m1.md)).

- [ ] Zbudować prywatny raport pokrycia per typ/miesiąc i snapshot źródła. Porównywać tylko wspólny zakończony zakres: starszy Takeout nie ma obowiązku zawierać dni po eksporcie.
- [ ] Z doświadczeń Health Sync wynika, że Connect może mieć wcześniejsze pomiary/zdarzenia nieobecne w danym eksporcie. Najpierw ocenić zakres różnic, bez obietnicy, że API uzupełni całość. To argument za opcjonalnym jednorazowym przechwyceniem, nie za obowiązkowym ciągłym Androidem.
- [ ] Jeśli potrzebne, zaprojektować minimalny adapter Connect według [planu Android](08-sync-android.md). Zachować oryginalny `dataOrigin`, device/recordingMethod, czas/offset i rozróżnienie własnych importowanych kopii Health Sync. Nie traktować wszystkiego z pakietu Health Sync jako oryginału Fitbit.
- [ ] Nie wyłączać integracji Google Health↔Connect tylko dlatego, że nowa aplikacja nie czyta Connect. Część danych telefonu może docierać do chmury właśnie tą drogą. Zmiana uprawnień dostawców jest osobną świadomą operacją.
- [ ] **TODO:** audyt poprzednich lat po M1 (zmiany urządzeń, schematów i modeli). Odczyt API sprzed 2026 działa na żądanie, a doby kwalifikują reguły 2026 ([kontrakty](../data-contracts.md#historia-sprzed-2026-2026-11-04)); audyt ma ocenić trafność progów dla starszych lat.

## Arkusze i zakończenie migracji

Tymczasowy arkusz zdrowia użytkownik dopuścił do zastąpienia/usunięcia. Nie jest już głównym produktem; ewentualny eksport pokazuje tę samą projekcję bazy co UI. Nie usuwać go teraz ani nie utrzymywać starego sync jako zależności MVP. Arkusz posiłków jest odrębnym źródłem z własnymi danymi/formułami: [plan żywienia](06-food-sources.md).

- [ ] Przed wygaszeniem starej aplikacji ocenić, czy zachowano wszystkie potrzebne oryginały i prywatne decyzje. Nie kasować Connect/chmury w celu „wyrównania” źródeł.
- [ ] Testy syntetyczne: kolejne eksporty, zmiana schematu, jednostki, części archiwum, kolizja kont, v1/v2, wykluczenie jednego rekordu, powtórny import, przerwanie, zmiana planu/reguł po preview, usunięcie wpływu importu i ochrona późniejszych korekt.
- [ ] Odbiór: odtworzenie z tych samych raw/wersji daje tę samą projekcję; żadnych podwójnych pomiarów przez transport; raport jasno rozróżnia braki źródła, niekwalifikowane i nieobsługiwane typy.
