# Wyszukiwanie żywności, OFF i importy żywienia

Zależność: wersjonowane produkty i komendy dziennika z [05](05-nutrition.md). Katalog produktów i import historii użytkownika to osobne adaptery. Nie trzeba uruchamiać wszystkich przed pierwszym ręcznym wpisem.

## Wielopoziomowe wyszukiwanie

1. Własne zaakceptowane produkty/receptury, historia użyć i aliasy. Najpierw kod kreskowy lub dokładne ID, potem nazwa/marka/wariant/jednostka.
2. Lokalny cache zewnętrznych źródeł z wersją, licencją i ważnością, w tym negatywny cache. Jawnie odróżnić prywatny produkt od cache OFF.
3. OFF i inne zatwierdzone katalogi: kod kreskowy, ustrukturyzowane filtry, następnie wyszukiwanie tekstowe. Ranking według dopasowania i jakości danych, a nie najwyższych makr.
4. Wyszukiwanie strony producenta/internetu, gdy wcześniejsze poziomy nie wystarczają. Zapisać URL/datę, przepisane wartości i potwierdzenie wariantu/porcji; nie traktować fragmentu wyników wyszukiwania jako zweryfikowanej etykiety.
5. Wpis ręczny lub wyraźnie oznaczony szacunek z pytaniem o brakującą ilość. Brak wyniku nie upoważnia do wymyślenia produktu.

To projekt aplikacji, nie wymagany algorytm konkretnego LLM. Serwer wykonuje wyszukiwanie/ranking i zwraca modelowi małą listę ID, porcji i wartości; model nie pobiera całej bazy. Powtórny produkt wykorzystuje zaakceptowaną wersję. Deduplikuj równoległe zapytania; TTL i odświeżenie zależą od źródła. Edycja produktu nie zmienia historii posiłków.

## Open Food Facts — implementacja i ograniczenia

- [ ] Przed kodowaniem sprawdzić [wstęp do API](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/), schemat i polskie produkty. Preferować odczyt barcode i selekcję potrzebnych pól. W sprawdzonej dokumentacji 2026-11-02 limity wynoszą 15/min/IP dla odczytu produktów i 10/min/IP dla search; traktować jako zmienne ustawienie, ponownie zweryfikować. Nie robić zewnętrznego search przy każdym znaku wpisywanym w UI.
- [ ] Backend identyfikuje aplikację przez wymagany User-Agent/kontakt, limituje żądania per źródło/IP, obsługuje 429/timeout i nie obchodzi limitów rotacją. UI pokazuje lokalne wyniki od razu, zewnętrzne na żądanie/z debouncingiem zgodnym z limitami.
- [ ] Normalizować kod, język, kraj, wariant, nutritional basis, pola na 100 g/100 ml/porcję i sygnały jakości. Brak makr/niezgodność porcji pozostają widoczne; zdjęcie etykiety może być źródłem korekty, nie dowodem automatycznej poprawności.
- [ ] Osobny cache/source catalog z identyfikatorem i licencją; prywatne posiłki i prywatne korekty jako oddzielne encje. Sama separacja tabel nie jest automatyczną gwarancją zgodności licencji. Przed dystrybucją/eksportem połączonej bazy sprawdzić obowiązki ODbL i zasady konkretnego dostawcy.
- [ ] OFF opisuje bazę jako ODbL, treść jako DbCL i zdjęcia jako CC BY-SA. Zachować atrybucję, relację do rekordu i wersję. Ich [instrukcja cache](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/creating-a-local-cache-of-open-food-facts-data/) wymaga uwzględnienia zasad łączenia danych i dzielenia się zmianami; [licencje](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/). Nie obiecywać bezwarunkowego scalenia OFF z dowolną komercyjną bazą.
- [ ] Nowe prywatne produkty zapisuj we własnej bazie. Publikacja poprawek/zdjęć do OFF to osobna świadoma funkcja; nie wysyłać automatycznie posiłków, danych zdrowotnych, konta ani prywatnych zdjęć. Przy publicznym wykorzystaniu opracować zgodną z licencją ścieżkę wkładu przed wdrożeniem.
- [ ] Inne źródła oceniać przez wspólną kartę: polskie pokrycie, barcode/typy produktów, dokładność, API/limity/koszt, retencja/cache/redistribucja, atrybucja i język. Kandydat dla produktów ogólnych: [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) — udokumentowane API z kluczem i limitami oraz dane CC0; pokrycie polskich marek niepotwierdzone. Nie dodawać wielu adapterów przed wykazaniem luki OFF/lokalnej bazy.

## FatSecret — historia użytkownika

- [ ] Zacząć od wskazanego eksportu CSV. [Pomoc FatSecret](https://www.fatsecret.com/fatsecret-app-help/reports-page/use-export-or-print-function) opisuje CSV/PDF w aplikacji. Sprawdzić, co faktycznie zawiera konto i eksport, zakres dat, lokalizację języka, rozdzielacze, produkty/porcje/posiłki i ewentualne sumy. PDF nie jest równoważnym parserowi CSV źródłem strukturalnym.
- [ ] Preview mapowania: data/czas, nazwa/typ posiłku, ilości/porcje, kcal/makra, brakujące pola. Jeśli eksport ma tylko sumę, zachować ją jako podsumowanie historyczne, nie tworzyć wymyślonych produktów ani rozpiski posiłków. Nie liczyć równocześnie sumy i składowych.
- [ ] Stabilne źródłowe ID, jeśli obecne; inaczej klucz importu z treści/konta/zakresu z obsługą identycznych rzeczywiście powtórzonych posiłków. Numer wiersza nie jest ID. Kolejny eksport i korekty mają wersje; nie zjadać dwóch takich samych posiłków tylko dlatego, że hash treści się zgadza.
- [ ] Osobno sprawdzić [API food_entries.get v2](https://platform.fatsecret.com/docs/v2/food_entries.get): dostęp edycji/produktu do dziennika istniejącego konta, uwierzytelnienie użytkownika, uprawnienia, historyczne daty, paginację, regiony, koszty i warunki przechowywania. Publiczna dokumentacja endpointu nie dowodzi, że dostaniemy dziennik obecnego konta.
- [ ] Import domyślnie do naszej bazy, bez zmiany FatSecret/Connect. Powiązania z tym samym jedzeniem ze starego arkusza/Health wymagają oceny i decyzji; nie sumować obu źródeł. Błędy lub niepełny eksport nie usuwają historii.

## Obecny arkusz posiłków i przejście z ChatGPT

- [ ] Użytkownik wskazuje konkretny plik/zakładki i prompt/formę obecnego zapisu. Sprawdzić realny schemat, ID, formuły, daty, jednostki, produkty/receptury, własne notatki i zjedzone kontra plan. Nie zakładać schematu na podstawie arkusza zdrowia.
- [ ] Zachować prywatny snapshot przed migracją. Importować wyniki formuł i dane źródłowe odpowiednio do ich znaczenia; błąd formuły ≠ zero. Preview, zakres i kontrola liczby wpisów/sum, zachowanie oryginału.
- [ ] Wybrać: jednorazowy import i przełączenie nowego wpisywania do aplikacji albo ograniczony okres importu z jednym właścicielem wpisu. Nie tworzyć automatycznej pętli arkusz↔baza↔Health.
- [ ] Przy przełączeniu zmienić instrukcję rozmowy ChatGPT i wybrany adapter, sprawdzić odczyt po zapisie, korektę i strefę. Możliwość skopiowania ustrukturyzowanego szkicu do formularza jest awaryjna, ale nie stanowi pełnego automatycznego odpowiednika obecnego workflow.

## Odbiór

- [ ] Testy cache/TTL/negative cache, barcode, polskich nazw/wariantów, nieznanych porcji, przerw źródła, limitów oraz atrybucji w UI/eksporcie.
- [ ] Testy powtórnego CSV, sortowania, dwóch identycznych posiłków, zmienionego eksportu, niepełnych makr, dziennych sum bez godzin i konfliktu z arkuszem. Osobno potwierdzić dostęp prawdziwego konta FatSecret, jeśli wybrany będzie API.
- [ ] Zmierzyć na syntetycznej/prywatnie zatwierdzonej próbce liczbę żądań zewnętrznych i wywołań LLM; powtórny znany produkt nie wymaga nowego web search. Nie deklarować oszczędności bez pomiaru.
