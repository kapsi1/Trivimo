# Health API — od sześciu metryk do pełnego katalogu

Cel: wszystkie dane, które publiczne API rzeczywiście pozwala odczytać dla konta/urządzeń użytkownika — nie każda funkcja aplikacji Google Health. Zakres M1 (OAuth, sześć metryk, okna 10-minutowe, listy źródeł, ponowienia, przyrost) jest wykonany: [M1 — wykonane](../completed/02-m1.md#health-api--wykonane-w-m1).

## Rejestr możliwości

- [ ] `DataTypeCapability`: ID dostawcy, stable/beta, definicja, typ (sample/interval/daily/session/catalog), jednostki, źródła, operacje, scopes, filtry, limity zakresu, paginacja, true-zero, czas, reconciliation, zmiany/usunięcia i strategia UI. Zapis to osobne pole.
- [ ] Inwentarz z [katalogu typów](https://developers.google.com/health/data-types) i [schematów v4](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints), z datą i rozbieżnościami; także inne zasoby API (konto, źródła, ustawienia).
- [ ] Status każdego typu: dedykowany widok / widok ogólny / wymaga zgody / niedostępny dla konta / tylko zapis / beta / jeszcze nieobsługiwany. Pusty wynik ≠ brak wsparcia. Typy write-only oznaczyć uczciwie.
- [ ] Nieznane pola, typy i enumy nie psują importu; bezpieczny ogólny widok struktury, jednostek, czasu i pochodzenia (bez renderowania HTML). Nowy typ wchodzi do agregatów dopiero po weryfikacji definicji.
- [ ] Limity per endpoint i budżet żądań w rejestrze, nie w stałych adaptera.

## Kolejność pokrycia

Mapa prac, nie deklaracja identycznych operacji:

| Grupa | Typy do zinwentaryzowania | Istotna różnica |
| --- | --- | --- |
| Ciało i energia uzupełniająca | height, BMR/basal energy, calories-in-heart-rate-zone | BMR informacyjny, poza porównywalnym total |
| Intensywność | active-minutes, active-zone-minutes, activity-level, time-in-heart-rate-zone, daily-heart-rate-zones, sedentary-period | Minuty, minuty ważone, klasy i strefy to różne znaczenia |
| Treningi i sprawność | exercise, floors, altitude, (run-/daily-)vo2-max, swim-lengths-data, TCX | Sesje, serie, okrążenia; pola zależne od sportu |
| HR i fizjologia | heart-rate-variability, daily-heart-rate-variability, daily-resting-heart-rate | RMSSD/SDNN; serie nie zastępują nocnego podsumowania |
| Noc i temperatura | sleep, oxygen-saturation, daily-oxygen-saturation, daily-respiratory-rate, respiratory-rate-sleep-summary, daily-sleep-temperature-derivations, core-body-temperature, skin-temperature-sensors | Podsumowania vs serie; czujniki skóry beta |
| Pozostałe zdrowie | blood-glucose, electrocardiogram, irregular-rhythm-notification | Osobne uprawnienia; bez własnej interpretacji diagnostycznej |
| Żywienie | nutrition-log, hydration-log, food, food-measurement-unit | Nie utożsamiać z własnym planerem |
| Pozostałe | menstrual-period, ovulation-test, moods, symptoms, nowe typy | Sprawdzić odczyt/zapis |
| Funkcje aplikacji Health | scores/Profile, cele, odznaki, Gemini | Obietnica dopiero po potwierdzeniu endpointu |

Po dodaniu typu uzupełniaj raport pokrycia. Typ bez danych konta: ścieżka syntetyczna i oznaczenie braku potwierdzenia.

## Odczyt i zadania — pozostało

- [ ] Odłączenie konta, unieważnienie tokenu i ponowna zgoda z UI (dziś tylko autoryzacja i odświeżanie tokenu).
- [ ] Dla nowych typów: rozdzielić `list/get`, `reconcile`, `rollUp/dailyRollUp`, katalog i załączniki; właściwe ID i [filtry](https://developers.google.com/health/filters), pełna paginacja (wielostronicowe listy nie mają dziś testu), stałe parametry checkpointu.
- [ ] Rodzina źródeł zapisywana w zadaniu, zanim pojawi się odczyt innej niż `all-sources` (zob. [kontrakty](../data-contracts.md#czas-jednostki-i-agregacja)). Potwierdzić działanie filtrów na dane pochodne.
- [ ] Okresowa rekonsyliacja starszych dób ([plan MVP](01-foundation-mvp.md)); ocena webhooków (autentyczność, odzyskiwanie po utracie zdarzeń) — dla lokalnego serwera polling może wystarczyć.
- [ ] Ponawianie innych 5xx niż 503 — tylko jeśli wystąpią.

## Strefy czasowe

Wykonane 2026-11-06: ustawienie strefy doby (jedna strefa globalna, magazyn v14), granice doby, okna, „dziś”, prognoza i etykiety godzin w wybranej strefie, jawne przeliczenie dób po zmianie, teksty w interfejsie i dokumentacji, testy ([wykonane](../completed/05-m2-strefy-czasowe.md)). Pozostało:

- [ ] Strefa przypisana do doby (podróże: doba zapisana tam, gdzie była mierzona; Google zapisuje czas cywilny pomiaru). Dziś strefa jest jedna dla całej bazy i nie zmienia się sama; test „zmiana strefy w trakcie podróży” czeka na ten model.
- [ ] Po zmianie strefy przeliczyć też dane zapisane z przypisaniem doby w chwili zapisu: wartości importów CSV z czasem ISO ze strefą (`csv_import_values.day`; plik i mapowanie są w bazie, więc przeliczenie jest możliwe jako wersjonowana operacja) oraz zasady dla notatek dnia (klucz = data).
- [ ] Ręczna weryfikacja na koncie użytkownika: migracja magazynu 13 → 14 (`migrate:canonical` przy zatrzymanym serwerze), zmiana strefy z interfejsu i uzupełnienie historii okien w nowej strefie. Test automatyczny tego nie potwierdza.
- [ ] Strefy z przesunięciem niepodzielnym przez 10 minut (np. +5:45 Katmandu): sprawdzić, czy okna producenta są wyrównane do UTC, i dopiero wtedy deklarować pełną obsługę okien w takich strefach.

## Weryfikacja agregatów i semantyki

- [ ] Doba cywilna producenta vs zakres Warszawy przy DST i podróży, pojedynczy dzień vs porcje, list/reconcile/rollup, źródła i zaokrąglenia — dla każdej nowej metryki.
- [ ] Rozbieżności producenta (np. kalorie sesji w przewodniku vs REST, wersje BMR) dokumentować, nie rozstrzygać zgadywaniem.
- [ ] Nocne podsumowania i chwilowe próbki kwalifikować osobno; granice ufności SpO₂ ≠ min/max.
- [ ] „Pełna prezentacja API” dopiero po raporcie całego aktualnego katalogu z listą niewspieranych operacji, beta i funkcji bez endpointu.
- Przegląd danych pobieranych, a nieużywanych w aplikacji nie należy do M2: jest w [etapie Q](09-quality-operations.md#przegląd-nieużywanych-danych-po-m6), gdy znani są wszyscy konsumenci danych.
