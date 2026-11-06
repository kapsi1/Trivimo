# Decyzje i granice

## Zasady produktu

1. Health Sync jest wstrzymany; powstaje nowa aplikacja. Danych nie migrujemy ani nie usuwamy przy okazji planowania.
2. Własna baza jest źródłem prawdy. Google Health API to główne bieżące źródło, Takeout — import historii, Connect — opcjonalny adapter.
3. Najpierw desktop w przeglądarce, Android ewentualnie później. Ciemny, prosty UI z tabelami i wykresami.
4. MVP: sześć metryk z README. Docelowo wszystkie faktycznie odczytywalne typy Health API, z widocznym brakiem dostępu. Trivimo ma pokazywać co najmniej te dane co aplikacja Health, także serie szczegółowe (np. godzinowe), ale bez obietnicy kopii całego UI Health (2026-11-03).
5. Jedna porównywalna definicja kalorii dla 2026 i przyszłości; sam BMR nie trafia do total. Szacunek telefonu bez opaski jest dopuszczony przy jawnym oznaczeniu źródła szacunku (zmiana 2026-11-03; wcześniej dni bez opaski miały być puste). Nie wymagamy Google Fit.
6. „Uwagi” obejmują wszystkie metryki. Surowe wartości można pokazać diagnostycznie, ale nie jako zakwalifikowane.
7. Później żywienie/planer, import FatSecret i AI (także głos/zdjęcia). Rozmowa w ChatGPT na telefonie ma móc dodać posiłek; własny czat nie jest jedyną drogą.
8. Edycja i publikacja do Health/Connect w granicach możliwości i zgodności semantycznej. Własny zapis działa także bez publikacji.
9. Audyt lat sprzed 2026 pozostaje TODO; wypełnienie każdej luki nie jest warunkiem sukcesu.

Pełny katalog API zastępuje dawne ograniczenia Health Sync do wybranych pól. Dostępność serii HR, sleep score czy Profile trzeba sprawdzić, bez fikcyjnych zamienników.

## Ustalenia datowane

**2026-11-03 — konto i autoryzacja.** Zaimportowany Takeout pochodzi z jednego konta Google; zapisano tylko lokalny identyfikator i decyzję przypisania. Kolejnych importów nie przypisywać automatycznie. Autoryzacja przetrwa restart: token odświeżania i lista zakresów zaszyfrowane Windows DPAPI (CurrentUser) w `google-token.dpapi` obok bazy; token dostępu tylko w pamięci, przeglądarka nie widzi sekretów. Odrzucenie odświeżenia (400/401) usuwa zapis, timeout i 5xx go zachowują. Poza Windows autoryzacja zostaje w pamięci.

**2026-11-03 — polityka automatycznych odczytów (magazyn v9).** (1) Odczyt o identycznej treści nie jest zachowywany; wcześniejszy dostaje znacznik „potwierdzono bez zmian”. (2) Nowszy odczyt zastępuje starsze automatyczne odczyty tego rodzaju i konta, które w całości obejmuje: pośrednie odczyty doby w toku od razu; dla trzech ostatnich zakończonych dób różne wartości są zachowywane (późne korekty). (3) Każde usunięcie zostawia wiersz audytu. (4) Odczyty ręczne i innych kont nigdy nie są usuwane. Zasada brzmi więc „najnowszy oryginał każdej doby plus ślad zmian”.

**2026-11-03 — kalorie (`google-energy-v1`).** Zamiast dwustanowego „dzień z opaską” pokazujemy udział doby z opaską i podział aktywnych kcal na okna z tętnem i bez (opaska noszona głównie na trening/spacer, więc próg byłby mylący). Starszy model (do ok. 2026-04-07) jest pokazywany jako wartość; doby samej energii bazowej są puste z uwagą. Zakończona doba odczytana po końcu jest od razu potwierdzona. BMR nie jest dostępny dla konta; jego wyświetlanie wymagałoby osobnej, wersjonowanej metryki wyliczanej i decyzji użytkownika.

**2026-11-03 — kolumna „Źródła” (magazyn v10)** z aplikacjami i urządzeniami, które zapisały kroki i kalorie aktywne; zastępuje uwagę „starszy model źródła”.

**2026-11-06 — rekonsyliacja starszych dób.** Późne korekty producenta poza oknem trzech ostatnich zakończonych dób wychwytuje okresowy ponowny odczyt: paczki jak w uzupełnianiu historii, od początku okna projekcji do czwartej doby wstecz, najdawniej sprawdzane pierwsze, do 2 odczytów na przebieg (ręcznie do 12). Ważność weryfikacji zależy od wieku doby (do 30 dni — 2 dni, do 90 — 7, starsze — 30). Polityka odczytów bez zmian: identyczna treść tylko potwierdza, różna zastępuje starszy odczyt z wierszem audytu. Dzięki temu nowsza korekta może zastąpić stary oryginał doby starszej niż trzy dni (zasada „najnowszy oryginał plus ślad zmian”). Okno nie obiecuje kompletności: korekta starszej doby jest widoczna dopiero po jej sprawdzeniu. Eksport CSV, kopia z UI, historia importów i telefon przeniesione do etapu Q.

**2026-11-06 — prognoza kalorii `prognoza-bez-wysilku-v2`.** Test wsteczny na 77 dobach pokazał, że `prognoza-spoczynek-v0` jest zaniżona o 3–21% (zależnie od godziny) przez brak dalszej aktywności. Krótko wdrożony średni profil `prognoza-profil-v1` usuwał to obciążenie, ale oczekiwał treningu o zwykłej porze (użytkownik: dziś treningu nie będzie), więc na dobach bez wysiłku zawyżał o 9–17%. Po uwadze użytkownika wdrożono `prognoza-bez-wysilku-v2`: tempo tej samej godziny zegara z okien historii bez znaczących kalorii aktywnych (≤ 3 kcal na okno); v0 zostaje dolną granicą i rezerwą bez historii. Liczba „Prognoza” znaczy więc „doba bez znaczącego wysiłku” (podpis w interfejsie), a nie wartość oczekiwaną. Prognoza nie jest zapisywana, migracja zbędna. Szczegóły: [wykonane](completed/02-m1.md#prognoza-spalonych-kalorii--wykonane-2026-11-06).

**2026-11-06 — odświeżanie co 5 minut, bez list źródeł.** Najmniejszy dozwolony interwał to 5 minut (wcześniej 15); limit Google to 300 żądań na minutę na użytkownika, a jeden przebieg to około 11 żądań. Masa i tkanka tłuszczowa są czytane najwyżej raz na godzinę. Automatyczne odświeżanie nie pobiera już list źródeł (kroki, kalorie aktywne), a kolumna „Źródła” w tabeli dni została usunięta (zastępuje wpis z 2026-11-03); kolumna „Opaska” zostaje, bo opiera się na oknach tętna. Zapisane wcześniej listy źródeł pozostają w bazie jako oryginały.

**2026-11-03 — kroki i dystans (`google-activity-v1`):** wartość dobowa producenta („uzgodnienie producenta”), telefon nie jest wykluczany.

**2026-11-04 — masa i tkanka tłuszczowa (`google-body-v1`):** średnia unikalnych pomiarów doby z API; kopie z różnych aplikacji liczone raz; Takeout tylko do porównania.

**2026-11-06 — porównanie z aplikacją Health** (wcześniej kryterium odbioru M1, wstrzymane 2026-11-04) usunięte z planu. Agent nie porównuje wyników z UI Health bez wyraźnej prośby, a Trivimo nie deklaruje zgodności z UI Health.

**2026-11-04 — UI.** Widok startowy Dzień; masa z dokładnością 0,1 kg; kroje Bricolage Grotesque, IBM Plex Sans i Mono. Kliknięcie wykresu powiększa go, „?” otwiera metadane, najechanie — tooltip. Strefa czasowa nie jest pokazywana w nagłówkach, tylko w ustawieniach. Prognoza kalorii do końca doby jako własna pochodna `prognoza-spoczynek-v0` (najprostsza metoda; inna to nowa wersja). Tętno dnia w UI to agregacja prezentacyjna okien, nie tętno spoczynkowe. Szczegóły: [projekt UI](design/ui.md).

**2026-11-04 — historia sprzed 2026 i CSV.** Odczyt API starszych lat uruchamiany ręcznie datą początkową, doby kwalifikowane regułami 2026 (audyt lat otwarty). Import dowolnego CSV z mapowaniem kolumn w wariancie „uzupełnia braki” — nie nadpisuje i nie sumuje się z Google (`csv-fill-v1`).

**2026-11-05 — wydajność (magazyn v13).** Sparsowane okna 10-minutowe zapisywane jako warstwa pochodna obok oryginałów, projekcja po odświeżeniu przyrostowa. Przepisanie backendu na inny język odrzucono: koszt był w architekturze, nie w języku.

## Ustalenia techniczne

Stos: TypeScript, React/Vite, Node z wbudowanym SQLite, lokalny serwer REST na 127.0.0.1 ([środowisko](development.md)). Próba parserów Kotlin nie uzasadniła mostu JVM ([P0](completed/01-p0-probes.md)). MCP będzie adapterem tych samych komend. Dzień kanoniczny: Europe/Warsaw, z zachowaniem czasu źródła i osobnych podsumowań cywilnych producenta.

## Decyzje otwarte

| Decyzja | Kiedy | Co rozstrzygnąć |
| --- | --- | --- |
| Strefa czasowa doby | Przed obsługą stref ([plan Q](plan/09-quality-operations.md#strefy-czasowe)) | Jedna strefa globalna czy strefa przypisana do doby (podróże); migracja i wersja reguł |
| Próg „dnia z noszeniem” | Gdy potrzebny w UI/analizie | Dziś tylko udział doby z opaską, bez progu |
| Nazwa i identyfikatory produktu | Przed publikacją | Wybiera użytkownik; wstępne wyszukiwanie nie potwierdza praw do marki/domeny |
| Wariant local-first PWA (bez serwera) | Przed dostępem mobilnym, razem z wyborem hosta | SQLite-WASM (OPFS) w przeglądarce, ewentualny bezstanowy proxy tylko do wymiany tokenów OAuth. Do sprawdzenia w dokumentach Google: OAuth bez sekretu, refresh token, CORS Health API. Koszty: brak synchronizacji w tle, ryzyko wyczyszczenia OPFS, brak REST/MCP, klucz AI nie w przeglądarce. Do tego czasu przypadki użycia nie zakładają HTTP; bez sterownika WASM |
| Zdalny dostęp i stale dostępny serwer | Przed mobilnym wpisywaniem/MCP | Prywatny host, tunel lub serwer: koszt, dostępność, prywatność |
| Uwierzytelnienie poza 127.0.0.1 | Przed każdym dostępem spoza komputera | Dziś `GET /api/session` wydaje cookie każdemu, kto dosięgnie portu (ochrona przed stronami, nie lokalnymi procesami). Nie wystawiać serwera ani Vite poza 127.0.0.1 bez parowania/tokenu, TLS i listy Origin z konfiguracji |
| Wariant ChatGPT Android | Spike M5 | Konto, klient, głos/zdjęcia, odczyt/zapis, działanie przy wyłączonym PC |
| Polityka AI i koszty | Przed wywołaniami modeli | Dostawca/model, wysyłane dane, limity |
| Mapy i licencje katalogów żywności | Przed adapterami | Dostawca, limity, atrybucja, przechowywanie |
| Pierwszy zapis zewnętrzny | M7 | Własny pomiar wagi lub posiłek; mapowanie per cel |
| Rola arkusza posiłków | Przed migracją żywienia | Import lub okres przejściowy z jednym właścicielem |
| Kolumna „Źródła” | Dowolnie | Pełne nazwy (dziś) czy skróty z listą w panelu |

Brak decyzji o żywieniu, mapach, serwerze zdalnym lub nazwie nie blokuje lokalnego MVP.
