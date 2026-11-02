# Źródła, doświadczenia i granice potwierdzenia

Przegląd publicznych dokumentów i dokumentacji projektu: **2026-11-02**. Nie przeprowadzono nowego OAuth, odczytu prywatnego konta API, zmiany uprawnień telefonu ani zapisu/usuwania pomiarów w ramach tworzenia tej dokumentacji. Wnioski z dotychczasowej analizy archiwum są doświadczeniem migracyjnym, nie dowodem obecnych odpowiedzi API.

## Materiały Health Sync

Poniższe linki dotyczą sąsiedniego projektu w dotychczasowym układzie katalogów. Nowe kontrakty i zadania są samodzielne; budujący aplikację nie musi kopiować całej starej dokumentacji.

| Materiał | Co przeniesiono do nowego planu |
| --- | --- |
| [Dashboard E](../../health-sync/docs/plan/dashboard.md) | Duży ekran, baza żywności, planer, AI, FatSecret, treningi i prywatne mapy |
| [Analiza źródeł](../../health-sync/docs/plan/data-sources.md) | Pochodzenie, semantyka per metryka, różnice modeli i brak pełnej kopii API↔Connect |
| [Plan kalorii](../../health-sync/docs/plan/calories.md) | Porównywalność, brak BMR-only, dni bez opaski, historia 2026 i TODO wcześniejszych lat |
| [Wspólne uwagi](../../health-sync/docs/plan/shared.md) | Ustrukturyzowane problemy wszystkich metryk i jedna projekcja Uwagi |
| [Kontrakt Takeout](../../health-sync/docs/takeout.md) | Stabilne ID/wersje, preview, zamrożone decyzje wznowienia, indywidualne wykluczenia, wersje snu |
| [Architektura](../../health-sync/docs/architecture.md), [kontrakty](../../health-sync/docs/data-contracts.md), [API](../../health-sync/docs/plan/google-health-api.md), [żywienie](../../health-sync/docs/plan/nutrition.md) | Rozdzielenie implementacji i planów, platformowych adapterów, tymczasowego eksportu zdrowia i właściwego źródła posiłków |

Nie przenosimy dawnej architektury Connect→Room→Sheets jako wymogu nowej aplikacji. Nie przenosimy dawnych wyników buildów jako dowodu nowego kodu. Własna baza i desktop są teraz wybrane przez użytkownika, a nie tylko wariantem rekomendacji.

Doświadczenia analizy danych: możliwa obecność Connect-only historii, różne daty snapshotów, kopie Fit/Fitbit i Health Sync, dni z samym bazowym wyliczeniem energii, różne modele active, niepełne pola podsumowań treningów i nakładające się wersje snu. Te przypadki wymagają syntetycznych testów oraz ograniczonej prywatnej walidacji. Prywatnych pomiarów, tras, kont i ID nie powielono tutaj.

## Google — źródła pierwotne

Ponowne sprawdzenie 2026-11-02, przed czytnikiem CSV: [instrukcja eksportu Google Health](https://support.google.com/googlehealth/answer/14236615?hl=en) i [instrukcja Google Takeout](https://support.google.com/fit/answer/3024190?hl=en) opisują drogę eksportu i informacje o formatach dołączone do archiwum. Nie stanowią potwierdzenia konkretnych nagłówków, jednostek ani kompletności plików dla tego konta; dokumenty bez wskazanej wersji schematu. Czytnik jest na razie ogólny i testowany syntetycznie.

| Dokument | Co sprawdzono / co nadal wymaga potwierdzenia |
| --- | --- |
| [Katalog Health API](https://developers.google.com/health/data-types) | Typy, reprezentacje i deklarowane operacje/scopes; tabela i szeroki scope nie dowodzą działania zapisu ani dostępności dla konta |
| [DataPoints v4](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints) | Modele danych i metody, pola numeryczne MetricsSummary; brak potwierdzonej ścieżki tekstowego podsumowania Gemini |
| [Agregacja](https://developers.google.com/health/aggregate-data) | UTC/civil-day, reconciliation, filtry noszenia i limity zakresów; rzeczywiste pokrycie/zgodność konta niebadane |
| [Filtry](https://developers.google.com/health/filters) | Filtry czasowe i źródeł, brak równoważności wszystkich rodzin; wybór rodziny wymaga próby per metryka |
| [Energia](https://developers.google.com/health/data-types/calories) | Active versus total/BMR, wskazanie legacy pól; rozbieżności schemat/przewodnik pozostają zadaniem próby |
| [Treningi](https://developers.google.com/health/data-types/workouts) | Sesje, pauzy, pola podsumowań i telemetry; ogólny opis kcal REST nie rozstrzyga każdej historycznej reprezentacji |
| [TCX](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/exportExerciseTcx) | HTTP media, brak GPS/partialData i wymagane zakresy aktywności oraz lokalizacji |
| [Vitals](https://developers.google.com/health/data-types/vitals), [sen](https://developers.google.com/health/data-types/sleep) | Podsumowania nocne/dzienne versus próbki, rozróżnienie metryk i danych sesji |
| [Temperatura skóry](https://developers.google.com/health/data-types/skin-temperature) | Poziom beta czujników, ograniczenia urządzeń i read-only mimo szerokiego scope; delta versus model bazowy |
| [Cloud/OAuth](https://developers.google.com/health/setup) | Klient, scopes, testowi użytkownicy i wymagania dostępu; żadnego nowego klienta nie utworzono |
| [Create](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/create) | Identifiable data points, asynchroniczna Operation i scopes; realny zapis per typ do sprawdzenia |
| [HC katalog](https://developer.android.com/health-and-fitness/health-connect/data-types), [HealthConnectClient](https://developer.android.com/reference/kotlin/androidx/health/connect/client/HealthConnectClient) | Osobne lokalne typy/uprawnienia i operacje; nie jest to webowe API własnej aplikacji |
| [AI assistance Google](https://developers.google.com/health/ai-assistance-and-developer-tools) | Pomoc Gemini dla deweloperów dokumentacji; nie endpoint gotowych narracji użytkownika Health |

Sprawdzone dokumenty nie uzasadniają obietnicy pełnego zapisu wszystkich danych, pełnej zgodności UI Health/API ani dostępu do narracji Gemini. Rozwiązaniem są capability matrix i jawne luki, nie niepubliczne endpointy.

## AI i interfejsy OpenAI

- [Połączenie ChatGPT z MCP/plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt): opis publicznego HTTPS oraz Secure MCP Tunnel i zasad konta/workspace. Wspiera analizę wariantu prywatnego hosta, bez potwierdzenia urządzenia użytkownika.
- [Uwierzytelnianie MCP/plugin](https://developers.openai.com/plugins/build/auth): OAuth 2.1/discovery/PKCE i weryfikacja uprawnień narzędzi; nie jest to token Health.
- [Responses API — MCP](https://developers.openai.com/api/docs/guides/tools-connectors-mcp): osobna ścieżka integracji przez API, nie dowód wsparcia tej samej funkcji w kliencie ChatGPT.

W tej analizie użyto skillu [OpenAI Docs](C:/Users/kk/.codex/skills/.system/openai-docs/SKILL.md) do doboru oficjalnych źródeł. Dostępność na Androidzie, uprawnienia konta, rozliczenia i zachowanie załączników pozostają osobnym spike; nie opieramy architektury na założeniu, że wystarczy sam prompt.

## Żywność, importy i mapy

- [OFF API](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/): wymagania klienta, endpointy/limity i wskazówki wyszukiwania; zmienne wartości ponownie sprawdzić przed kodowaniem. Strona `world.openfoodfacts.org/discover` wskazana przez użytkownika nie dała się pobrać w tym przeglądzie; wykorzystano oficjalne docs projektu.
- [OFF licencje](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/), [cache](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/creating-a-local-cache-of-open-food-facts-data/): pochodzenie, atrybucja i obowiązki przed łączeniem/udostępnianiem katalogów; to nie pełna analiza prawna konkretnego wdrożenia.
- [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/): kandydat dla produktów ogólnych, wymaga klucza i ma limity, dane opisane jako public domain/CC0. Nie zaimplementowano adaptera ani nie oceniono pokrycia polskich marek.
- [FatSecret eksport](https://www.fatsecret.com/fatsecret-app-help/reports-page/use-export-or-print-function), [food_entries.get](https://platform.fatsecret.com/docs/v2/food_entries.get): udokumentowane ścieżki, bez weryfikacji zawartości eksportu/dostępu istniejącego konta użytkownika.
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/): mapy wymagają wyboru dostawcy, atrybucji i zgodnego użycia; darmowa biblioteka nie oznacza dowolnego bezpłatnego hostingu kafelków/offline.

Przed implementacją odświeżyć tylko źródła danego etapu i zapisać wynik. Zmiany w dokumentacji producentów nie powinny niejawnie przeliczać już zaakceptowanej historii.
