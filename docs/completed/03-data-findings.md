# Obserwacje z danych konta (2026-11-03 – 2026-11-04)

Wyniki prób, na których oparto reguły w [kontraktach](../data-contracts.md). Tylko odczyt, jedno konto i jedna opaska; wartości celowo pominięte, raporty z liczbami są poza repozytorium. To dowody historyczne, nie reguły — obowiązujące są reguły `google-*-v1` w kontraktach.

## Kalorie

- `total-calories` z API (doba cywilna, `all-sources`) zgadza się z aplikacją Health z dokładnością do zaokrąglenia na większości sprawdzonych dób. Wyjątek: 2026-11-01 nagłówek Health ok. 0,55 % (ok. 20 kcal) wyżej niż API, także po powtórnym odczycie; godzinowy `rollUp` doby (wtedy Europe/Warsaw) sumuje się do `dailyRollUp`, więc przyczyną nie są granice doby ani rodzina źródeł. **Nierozstrzygnięte.**
- Suma minutowego pliku Takeout `calories` różni się od API o 0,1–0,3 % (poniżej 6 kcal na pełnych dobach), także gdy wierszy jest mniej niż 1440 (wiersze mogą obejmować dłuższe przedziały). Takeout to punkt odniesienia, nie źródło identycznych wartości.
- Dzień bez opaski ma pełne, niezerowe total (BMR + aktywność telefonu), więc total i obecność minut nie dowodzą noszenia.
- `active-energy-burned` z API odpowiada sumie minut Takeout ze źródła „Google Health App” na 76 z 91 dób; na dobach z minutami „Phone Health Connect” API wlicza tylko ich część. Suma wszystkich wierszy Takeout jest błędnym odniesieniem. Rola „Phone Health Connect” pozostaje otwarta.
- Filtr `google-wearables` nie oddziela telefonu od opaski (sierpień bez opaski: wynik jak `all-sources`; październik z opaską: total wyższe nawet o kilkanaście procent). Nie jest dowodem noszenia; `all-sources` odpowiada aplikacji Health.
- Opaska vs sam telefon przy podobnym wysiłku (okna 10-min, kroki z jednego źródła): telefon daje niemal stałe kcal na krok (model krokowy); opaska zależnie od intensywności — przy szybkim marszu ok. 20–25 % mniej, przy aktywności bez kroków znacznie więcej. Wniosek obserwacyjny (opaska noszona głównie na trening/spacer), nie współczynnik korekty.
- BMR niedostępny: `basal-metabolic-rate` zwraca 400, `basal-energy-burned` pustą odpowiedź, Takeout nie ma pliku BMR; total − aktywne nie jest BMR.

## Tętno jako dowód pomiaru

- `rollUp` `heart-rate` z oknem `600s` działa w zakresie `health_metrics_and_measurements.readonly`, zwraca tylko okna z danymi i pola `beatsPerMinuteAvg/Min/Max` bez licznika próbek; limit 14 dni na zapytanie.
- Doba z opaską przez cały czas: 144 okna; bez opaski: 0; częściowe noszenie zgodne z minutami Takeout.
- Takeout 2026-05-07 – 2026-11-03: rozkład dwumodalny — 51 dób bez tętna, 46 z krótkim pokryciem (1–71 okien), 84 z ≥ 72 oknami. Dlatego zamiast progu „dzień z noszeniem” pokazujemy udział doby z opaską.
- Suma okien aktywnej energii równa się dziennemu agregatowi na wszystkich pełnych dobach (różnica < 0,01 kcal).

## Kroki, dystans i źródła

- Kroki w Takeout pochodzą równolegle z kilku źródeł (opaska, „MobileTrack”, „Phone Health Connect”, „Google Fit Health Connect”); to repliki, nie wolno ich sumować. Producent wybiera jedno: styczeń–kwiecień większe z dwóch źródeł Health Connect, doby z opaską — opaska, pozostałe — „MobileTrack” (dystans „Google Health App”). „Phone Health Connect” od lipca ok. dwukrotność API (podwójne liczenie po stronie Health Connect).
- Wszystkie 306 zakończonych dób 2026 (stan z 2026-11-03, strefa doby Europe/Warsaw): wartość dobowa kroków/dystansu równa sumie okien doby w strefie ustawienia.
- Odczyt z 2026-11-06 (strefa nadal Europe/Warsaw, jedna wersja ustawienia): dla 2026-10-14 – 10-27 dobowy dystans **nie** równa się sumie okien `distance-10m` (14 dób; kroki w tych dobach zgodne). Różnice mają oba znaki: okna większe od dobowej wartości o 0,1–3,6 km (4 doby ponad 1 km; 22.10: 3,17 vs 5,21 km, 24.10: 8,13 vs 11,76 km), na pięciu dobach dobowa wartość większa o 8–40 m. Przesunięcie granic doby o −6…+6 h nie daje równości w żadnej z tych dób, więc nie jest to kwestia strefy ani granicy doby. Odczyty dobowy i okienny zrobiono w odstępie minut, więc nie jest to także różnica czasu odczytu. Przyczyna **nierozstrzygnięta** (kandydaci: powtórzone źródła w oknach, w których dobowy agregat wybiera jedno; zmiana po stronie producenta; zaokrąglenia). Jednorazowa diagnostyka 2026-11-07 (lista rekordów `distance` 12–29.10 z API, tylko odczyt, bez zapisu do bazy; sumy mm per doba cywilna i źródło): rekordy dystansu pochodzą równolegle z kilku źródeł — Fitbit (`PASSIVELY_MEASURED` i osobno `DERIVED`), Health Connect telefonu i Google Fit przez Health Connect — więc suma wszystkich rekordów to wielokrotność wartości dobowej (repliki, nie sumować). Wartość dobowa ani suma okien nie równa się sumie żadnego pojedynczego źródła ani prostej kombinacji; na dobach 22.10 i 24.10 suma okien jest bliska sumie rekordów Fitbit `DERIVED` (5,21 vs 5,18 km; 11,76 vs 11,71 km), a wartość dobowa jej nie śledzi. Wniosek ostrożny: okna i agregat dobowy wybierają różne mieszanki źródeł (w tym `DERIVED`); mechanizmu wyboru nie ustalono, a sumy per doba cywilna rekordu nie są dokładnie granicami okien. Wymaga stałego odczytu źródeł dystansu (rodzaj `distance-sources`, migracja v16), jeśli ma służyć do reguły. Aplikacja pokazuje te doby jako nieporównywalne („Dystans: inny lub nieustalony dzień źródła”). Dobowa wartość i okna pozostają w danych źródłowych; reguły nie poluzowano.
- Źródła wpisów 2026 (liczby dób): do kwietnia kroki tylko z Google Fit i Androida przez Health Connect; od 2026-05-07 opaska i MobileTrack; Google Fit znika w maju i wraca we wrześniu–październiku; w październiku kalorie aktywne z Health Connect telefonu (24 doby). Pomiary tętna 2026-04-30 – 05-05 to aparat telefonu w Google Fit (potwierdził użytkownik).

## Masa i tkanka tłuszczowa

- Pomiary od 2026-04: 124 rekordy masy, w tym 18 kopii z Google Fit przez Health Connect (ta sama sekunda i wartość co wpis Fitbit), 100 rekordów tłuszczu z jednego źródła. Takeout ma te same liczby rekordów w tych samych miesiącach.

## Historia sprzed 2026 (2026-11-04)

- API zwraca kroki i dystans od ok. 2023-07, kalorie total i masę w 2023–2025, bez kalorii aktywnych; lata 2018–2022 puste. Trafność progów reguł 2026 dla tych lat jest niesprawdzona.
