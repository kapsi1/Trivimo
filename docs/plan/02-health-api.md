# Health API — od sześciu metryk do pełnego katalogu

Cel docelowy: wszystkie dane, które publiczne API rzeczywiście pozwala odczytać dla konta/urządzeń użytkownika. Nie jest to obietnica wyświetlenia każdej funkcji aplikacji Google Health. Dokumenty publiczne sprawdzono 2026-11-02; nie wykonano OAuth ani odczytu konta podczas tworzenia planu.

## Rejestr możliwości

- [ ] Utworzyć `DataTypeCapability`: ID dostawcy, wersja stable/beta, definicja, typ sample/interval/daily/session/catalog, jednostki, źródła/urządzenia, operacje, scopes, filtry, limity zakresu, paginacja, true-zero, czas, reconciliation, zmiany/usunięcia i strategia UI. Obsługa zapisu jest osobnym polem, nie konsekwencją odczytu.
- [ ] Zbudować inwentarz z [katalogu typów](https://developers.google.com/health/data-types) i [schematów v4](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints), z datą i rozbieżnościami. Osobno sprawdzić inne zasoby API, np. dane konta, źródeł i ustawień, jeśli udostępnione. Nie ograniczać „wszystkich danych” do sześciu kolumn ani samej unii data point.
- [ ] Rejestrować status każdego typu: obsługiwany z dedykowanym widokiem / obsługiwany ogólnie / wymaga zgody / niedostępny dla konta / tylko zapis / beta / nieobsługiwany jeszcze. Nie klasyfikować pustego wyniku jako braku wsparcia.
- [ ] Typy tylko zapisywalne, m.in. część danych reprodukcyjnych, nastrojów i objawów według sprawdzonego katalogu, oznaczyć uczciwie. Własny zapis można pokazać z bazy, ale nie opisywać jako odczytany z Google.
- [ ] Zachować nieznane pola i typy/enumy bez awarii importu. Bezpieczny ogólny widok strukturalny, jednostek/czasu i pochodzenia zapewnia minimalną prezentację nowych odczytywalnych danych; nie renderować nieufnego HTML. Nowe typy wymagają weryfikacji definicji przed udziałem w agregatach.

## Kolejność pokrycia

Poniższa lista jest mapą prac, nie deklaracją identycznych operacji dla każdego typu:

| Grupa | Typy/pola do zinwentaryzowania | Prezentacja i istotna różnica |
| --- | --- | --- |
| M1: ciało i aktywność | weight, body-fat, steps, distance, active-energy-burned, total-calories | Pomiary versus agregat dnia; pochodny total nie ma zwykłej ścieżki listowania |
| Ciało i energia uzupełniająca | height, BMR/basal energy według rzeczywistej wersji, calories-in-heart-rate-zone | BMR informacyjny poza porównywalnym total; przewodnik i schema mogą się różnić |
| Intensywność | active-minutes, active-zone-minutes, activity-level, time-in-heart-rate-zone, daily-heart-rate-zones, sedentary-period | Minuty, ważone minuty, klasy aktywności i fizjologiczne strefy mają osobne znaczenia |
| Treningi i sprawność | exercise, floors, altitude, run-vo2-max, vo2-max, daily-vo2-max, swim-lengths-data, TCX | Sesja, serie, okrążenia i dzienny model; pola zależne od sportu/sprzętu |
| HR i fizjologia | heart-rate, heart-rate-variability, daily-heart-rate-variability, daily-resting-heart-rate | RMSSD/SDNN i model RHR z metodą; serie nie zastępują nocnego podsumowania |
| Noc i temperatura | sleep, oxygen-saturation, daily-oxygen-saturation, daily-respiratory-rate, respiratory-rate-sleep-summary, daily-sleep-temperature-derivations, core-body-temperature, skin-temperature-sensors | Podsumowania/serie, delta/temperatura; czujniki skóry osobno beta, gdy dostępne |
| Pozostałe zdrowie | blood-glucose, electrocardiogram, irregular-rhythm-notification | Różne uprawnienia, duże serie ECG; nie interpretować diagnostycznie własnym algorytmem |
| Żywienie | nutrition-log, hydration-log, food, food-measurement-unit | Dziennik, nawodnienie i katalog to różne zasoby; nie utożsamiać z własnym planerem |
| Pozostałe obszary | menstrual-period, ovulation-test, moods, symptoms oraz późniejsze nowe typy | Dokładnie sprawdzić odczyt/zapis; nie wymyślać odczytu z obecnego wyłącznie write-only |
| Funkcje aplikacji Health | scores/Profile, cele, odznaki, AI/Gemini i inne widoczne w aplikacji | Dopiero potwierdzenie endpointu i uprawnień pozwala obiecać import; brak API jawny |

Po dodaniu typu uzupełniaj raport pokrycia. M2 i kolejne iteracje obejmują cały rejestr, również dane bez dedykowanego kafelka. Dla typu bez danych konta sprawdź ścieżkę syntetycznie i oznacz brak potwierdzenia realnego rekordu.

## OAuth, odczyt i trwałe zadania

- [ ] Przed implementacją sprawdzić [konfigurację Cloud/OAuth](https://developers.google.com/health/setup): klient właściwy dla sposobu hostowania, redirect, konto testowe, minimalne read-only dla M1, bez żądania całego zdrowia i lokalizacji na zapas. Tokeny po stronie serwera w zabezpieczonym magazynie; rotacja, unieważnienie i ponowne zgody.
- [ ] Adapter rozdziela `list/get`, `reconcile`, `rollUp/dailyRollUp`, katalog i pobieranie załączników. Nie każdy typ obsługuje każdą metodę. Przykład: total to pochodny agregat, nie zwykłe rekordy list.
- [ ] Przy zapytaniach stosować właściwe nazwy ID i filter (myślniki versus podkreślenia), zamknięte-otwarte zakresy, pełną paginację i niezmienny zestaw parametrów checkpointu. [Filtry](https://developers.google.com/health/filters).
- [ ] Wersjonować politykę rodzin źródeł: domyślne wszystkie źródła nie są tym samym co Google wearables. Nie wyłączać telefonu z kroków automatycznie na podstawie polityki kalorii. Potwierdzić oddziaływanie filtrów na agregaty i dane pochodne.
- [ ] Respektować limity per endpoint, 429/Retry-After, backoff z jitter, ograniczoną współbieżność, przerwanie/wznowienie i budżet żądań. Sprawdzony przewodnik agregacji podaje 14-dniowe zakresy dla wybranych metryk i 90 dla innych; ponownie sprawdzić przed implementacją i przechowywać w konfiguracji możliwości, nie w uniwersalnej stałej.
- [ ] Zachowywać parametry/digest odpowiedzi, wersję i datę pobrania oraz informację, czy ukończono cały zakres. Hash odpowiedzi bez przechowania treści nie wystarcza do późniejszego odtworzenia reguł.
- [ ] Wdrożyć przyrost, overlap ostatnich dni i okresową rekonsyliację historii; sprawdzić dostępne webhooks, ich autentyczność i odzyskiwanie po utracie zdarzeń. Webhook jest sygnałem do odczytu, nie niepodważalnym pomiarem. Dla lokalnego serwera polling może być prostszy niż webhook.
- [ ] Wygaśnięcie zgody, niedostępność API i opóźniona synchronizacja opaski nie kasują bazy. UI pokazuje kiedy i do jakiej daty odczyt zakończył się sukcesem. Brak odpowiedzi nie zmienia wyniku na zero.

## Weryfikacja agregatów i semantyki

- [ ] Porównać civil-day producenta i fizyczny zakres Warszawy, DST/podróż, pojedynczy dzień versus porcje, list/reconcile/rollup, źródła i zaokrąglenia. Testuj niezmienność względem podziału tylko dla równoważnych parametrów/definicji.
- [ ] Udokumentować rozbieżności producenta: np. opis kalorii sesji w przewodniku versus ogólny opis pola REST; BMR/basal energy w różnych wersjach. Nie rozstrzygać ich zgadywaniem ani dzieleniem sumy po długości sesji. Pole może pozostać „kalorie sesji producenta, definicja do potwierdzenia”.
- [ ] Osobno kwalifikować nightly daily summaries i chwilowe próbki; znane pułapki są w kontraktach. Nie przypisywać confidence bounds SpO₂ do min/max ani wartości 0 zasypiania z domyślnego pola do rzeczywistego pomiaru.
- [ ] Pełna prezentacja API zakończona dopiero po raporcie dla całego aktualnego katalogu, z listą celowo niewspieranych operacji, beta i funkcji Health bez endpointu. Nie opisywać roadmapy Google jako wykonanej funkcji.
