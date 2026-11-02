# Kontrakty danych nowej aplikacji

Reguły docelowe, do implementacji i weryfikacji. Jedna wersjonowana definicja obowiązuje historię 2026 i kolejne dni. Źródłowe dane pozostają dostępne także wtedy, gdy nie kwalifikują się do porównywalnej tabeli.

## Oryginał, kopia, wynik i korekta

1. Nie utożsamiaj transportu z urządzeniem pomiarowym. Dane odczytane z telefonu/Connect nie muszą być oszacowane przez telefon; pole zapisane przez Health nie dowodzi noszenia opaski. Zapisuj producenta, urządzenie/metodę i rodzinę źródła, o ile są rzeczywiście dostępne; w przeciwnym razie „nieznane”.
2. Tożsamość źródłowa: dostawca + konto + typ + oryginalne ID. Gdy brak ID, jawny wersjonowany klucz z danych rekordu, nie numer wiersza/nazwa pliku. Hash treści to rewizja, nie zawsze ID. Zachowuj precyzję czasów i liczb.
3. API i Takeout mogą zawierać ten sam pomiar w innych jednostkach/precyzji. Łącz tylko po jednoznacznym dopasowaniu lub zatwierdzonej decyzji; nie dodawaj ich do siebie. Zapis własny odczytany z Connect/API to replika, nie nowy pomiar.
4. Priorytet stosuj dopiero między równoważnymi kandydatami spełniającymi kontrakt. Dla danych Google preferuj aktualne kwalifikowane API, historycznie odpowiedni Takeout; oryginał lokalnej aplikacji z Connect może być jedynym właściwym źródłem danego typu. Nowszy czas importu nie dowodzi nowszego pomiaru.
5. Edycja użytkownika tworzy wersję/korektę z relacją do oryginału; zachowaj, co jest wynikiem producenta, własnym wpisem albo pochodną. Jawna korekta może być wybranym wynikiem aplikacji; eksport do dostawcy jest osobną operacją.

## Stany i kompletność

Rozdziel `value` od statusu: `valid`, `provisional`, `missing`, `incomplete`, `incomparable`, `conflict`, `stale`, `unsupported`, `permission_denied`, `source_error`. To propozycja modelu; implementacja może rozdzielić jakość, świeżość i dostęp na osobne pola zamiast jednej wykluczającej listy. `null` nie oznacza 0. Potwierdzone zero z obsługującego je źródła zachowaj z dowodem; pusta lista/błąd/OAuth tego nie dowodzi.

Zachowuj ostatni potwierdzony wynik po przejściowym błędzie, z oznaczeniem nieaktualności i czasem ostatniego sukcesu. Świadoma dyskwalifikacja po nowej kompletnej ocenie może wyczyścić wynik kanoniczny, zachowując wersje i przyczynę. Usunięcie ze źródła potwierdza tombstone albo pełna udana rekonsyliacja odpowiedniego zakresu, nigdy sam pusty odczyt.

Brak HR nie dowodzi braku opaski, a obecność jednej próbki nie dowodzi noszenia cały dzień. Nie ustanawiaj bez sprawdzenia arbitralnego progu „20 godzin = pełny pomiar”. Polityka kwalifikacji określa wymagane metadane i dowody z dostępnych źródeł; niepewność pozostaje jawna. Wynik dnia w toku może być pokazany jako częściowy, wyłączony z porównań pełnych dób.

## Czas, jednostki i agregacja

- Przechowuj fizyczny czas UTC, oryginalny offset/strefę, datę cywilną źródła i regułę przypisania dnia. Dzień aplikacji domyślnie Europe/Warsaw, przedział `[start, end)`, bez założenia 86 400 sekund. Strefa widoku i grupowanie danych nie zmieniają się niejawnie podczas podróży.
- Podsumowanie cywilne API oparte na offsetach pomiarów nie musi być tym samym co warszawski przedział UTC. Jeśli nie da się wiarygodnie przeliczyć, pokaż osobno „dzień producenta”, z oznaczeniem nieporównywalności, zamiast podmienić kanoniczny wynik.
- Jednostki wewnętrzne jawne i jednolite; gram/milimetr/sekunda/API int64 nie są kilogramem/kilometrem/minutą. Zachowaj dokładne liczby i jednostkę źródła. Zaokrąglaj wyłącznie w prezentacji, nie przed deduplikacją/sumą. kJ/kcal, procent/ułamek, mg/g oraz milli-breaths/min wymagają testów.
- Reconciliation dostawcy i sumowanie surowych rekordów mają różne znaczenie przy nakładaniu. Nie zastępuj reconciliation prostą sumą. Te same zapytania o dzień muszą dawać ten sam wynik niezależnie od rozmiaru porcji; rozbieżność zgłoś jako problem, nie maskuj doborem daty początku.
- Nocne podsumowania przypisuj według końca snu, z zachowaniem sesji i oznaczenia głównej nocy/drzemki. Nie dodawaj nakładających się wersji algorytmu snu. Czuwanie i krótkie przebudzenia mogą nakładać się na fazy, więc nie sumuj bez rozstrzygnięcia.

Różne modele czasu i agregacji opisują [Google rollUp/dailyRollUp](https://developers.google.com/health/aggregate-data). Implementacja przechowuje także parametry zapytania, rodzinę źródeł, wersję kontraktu i kompletność odpowiedzi.

## Sześć metryk MVP

| ID i etykieta | Definicja kanoniczna | Braki / uwagi |
| --- | --- | --- |
| `weight_daily_mean`, Masa ciała, kg | Średnia arytmetyczna unikalnych zaakceptowanych ważeń danego dnia | Bez przenoszenia ostatniej wagi jako pomiaru nowego dnia; ostatnia znana waga osobno |
| `body_fat_daily_mean`, Tkanka tłuszczowa, % | Średnia arytmetyczna unikalnych zaakceptowanych pomiarów procentowych dnia | Nie wyliczaj z BMI ani masy; nie łącz nieporównywalnych metod po cichu |
| `steps_daily`, Kroki, szt. | Dzienny wynik po wybranej reconciliation i deduplikacji | Jawna polityka wearable/phone dla kroków; nie wykluczaj telefonu tylko z powodu polityki kalorii |
| `distance_daily`, Dystans, km | Dzienny dystans z uzgodnionej rodziny źródeł, bez dodawania treningów do total dnia | Dystans krokomierza i GPS można pokazać osobno; nie zgaduj z liczby kroków |
| `total_energy_daily`, Spalone kalorie, kcal | Całkowity wydatek obejmujący energię bazową i aktywną, zakwalifikowany według poniższej polityki | Sam BMR i wynik zastępczy nie są porównywalnym total dnia |
| `active_energy_daily`, Aktywne kalorie, kcal | Energia aktywności ponad energię bazową, według modelu producenta i tej samej polityki porównywalności | Brak nie oznacza zera; nie używaj legacy `activityCalories` jako bezpośredniego zamiennika |

## Kontrakt kalorii — historia i bieżące dni

Użytkownik wybrał puste pola, jeśli nie ma porównywalnych danych, zwłaszcza w dni bez opaski. Nie zastępuj ich modelem telefonu ani wyliczeniem z kroków. Nie wymagaj instalacji Fit. Ten sam kontrakt kwalifikuje 2026 i kolejne lata; ocenę wcześniejszych lat zaplanowano osobno.

API rozróżnia aktywną energię bez bazowej oraz całkowitą energię pochodną z aktywnej i BMR. Historyczne „kalorie podczas aktywności” mogą zawierać bazowy wydatek w aktywnych minutach i mają inną definicję. [Dokumentacja energii](https://developers.google.com/health/data-types/calories).

Wymagania implementacyjne:

- Zachowuj raw BMR/total/active jako osobne typy. `total-active` nie staje się nowym pomiarem BMR. Nie odejmuj arbitralnej stałej bazowej ani wartości BMR z innej daty/źródła, żeby „odzyskać” active.
- Nie uznawaj wszystkich powtarzalnych kalorii za błąd i wszystkich zmiennych za dobre. Stała wartość jest sygnałem do analizy pochodzenia, nie regułą usuwania. Wykrycie samego BMR, niepełnego zakresu lub nieporównywalnego modelu blokuje kwalifikację.
- Nie zakładaj, że całe `ActiveCaloriesBurnedRecord` Connect pochodzi z telefonu albo z opaski. Ocena dotyczy konkretnego rekordu i jego łańcucha pochodzenia. Filtr wearables w API jest użyteczny, ale sam nie dowodzi kompletności doby; sprawdź, jak dotyczy pochodnego total/BMR.
- Nie sumuj kalorii treningów, aby uzyskać active dnia: istnieje aktywność poza sesjami i nakładanie. Strefy HR/AZM służą analizie, nie odtworzeniu zastrzeżonego modelu producenta.
- Do backfill active używaj oryginalnych danych o potwierdzonej definicji. Jeśli brak równoważnych danych, zachowaj lukę. Eksperymentalny własny model wymaga osobnej nazwy, wersji i walidacji; nie wchodzi do tych kolumn.
- Bieżący częściowy dzień i niepełne noszenie mają jawne ograniczenia; nie pokazuj wartości jako pełnego porównywalnego dnia bez kwalifikacji. Próg i dowód kwalifikacji do ustalenia w próbie M1, nie wprowadzać pozornej pewności.

## „Uwagi” i własne notatki

`DataIssue` ma zakres dnia/sesji/metryki, stabilny kod, źródło, stopień, uzasadnienie, wersję oceny i stan rozwiązania. Tekst kolumny „Uwagi” jest deterministyczną projekcją problemów wszystkich wybranych metryk. Stabilna kolejność, bez duplikatów i dopisywania kolejnej kopii przy odświeżeniu. Możliwy dzień z samymi uwagami.

Przykłady komunikatów: „Kalorie: tylko energia bazowa”, „Aktywne kalorie: nieporównywalne źródło”, „Sen: niepełne fazy”. Nie pisz „brak opaski”, jeśli wiadomo wyłącznie o braku danych. Globalna awaria sieci jest stanem synchronizacji; nie zalewaj każdego dnia tym samym komunikatem bez związku z oceną.

Usuwaj przyczynę z bieżącej projekcji po potwierdzonym rozwiązaniu, zachowując historię. Błąd odczytu nie oznacza rozwiązania. Notatki użytkownika są osobnym edytowalnym polem/encją; przeliczenie automatycznych uwag ich nie nadpisuje. Wartości, jakość i uwagi mają tę samą rewizję w tabeli, szczegółach i eksporcie.

## Typy o podobnych nazwach

Daily HRV ≠ średnia wszystkich próbek HRV; RMSSD ≠ SDNN. Nocne SpO₂ ≠ średnia chwilowych pomiarów doby; granice ufności ≠ min/max. Tętno spoczynkowe ≠ minimum ani średnia HR dnia. Delta temperatury skóry ≠ temperatura głęboka. AZM ≠ zwykłe minuty treningu. Podsumowanie sesji ≠ suma całego dnia. Sleep efficiency ≠ ogólna ocena snu. Każda taka para ma osobne ID/etykietę i jednostkę, bez cichego fallbacku. [Vitals](https://developers.google.com/health/data-types/vitals), [sen](https://developers.google.com/health/data-types/sleep), [schematy](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints).
