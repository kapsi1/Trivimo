# Architektura

Semantyka danych: [kontrakty](data-contracts.md); decyzje: [rejestr](decisions.md); uruchomienie: [środowisko](development.md).

## Stan implementacji (2026-11-06)

Modułowy monolit TypeScript: React + Vite w przeglądarce, lokalny serwer Node z REST na 127.0.0.1 i jeden plik SQLite (`node:sqlite`) z jawnymi migracjami. Jeden właściciel zapisu bazy; importy i odczyty Google wykonuje serwer.

| Katalog | Zawartość |
| --- | --- |
| `apps/web` | Widoki Dzień, Tabela dni, Trendy, Źródła danych, Ustawienia; placeholdery treningów i jedzenia ([projekt UI](design/ui.md)) |
| `apps/server` | REST, sesja lokalna, OAuth Google, `GoogleSyncService`, importy Takeout/CSV, skrypty CLI (import, weryfikacja, kopia, migracja, `google:read`) |
| `packages/domain` | Doba w strefie z ustawienia (`day-zone-v1`), kwalifikacja (`google-energy-v1`, `google-activity-v1`, `google-body-v1`), repliki pomiarów, uwagi, jednostki, prognoza; bez UI/HTTP |
| `packages/contracts` | Schematy Zod wejść/wyjść (dzień, snapshot, rekordy źródłowe, import CSV) |
| `packages/storage` | Migracje, zadania i strony odczytów Google, snapshoty dób, notatki, importy CSV, kopia i weryfikacja |
| `packages/adapters` | Google Health (plan porcji, rollUp/dailyRollUp/list, limity 429), Takeout (katalog i ZIP), CSV z mapowaniem |

Magazyn ma wersję 14 (`currentStoreVersion`, sprawdzanie przez `storeHas(version, since)`). Kluczowe elementy:

- **Oryginały.** Strony odpowiedzi Google w zadaniach (`google_read_jobs`, `google_read_pages`) z kursorem wznowienia, skrótem konta i metadanymi (`google_read_job_meta`, audyt zastąpień `google_read_supersessions`); pliki Takeout jako bajty z planem i checkpointem per plik; pliki CSV jako tekst z mapowaniem i decyzjami (`csv_imports*`).
- **Rodzaje odczytu Google:** pomiary (masa, tłuszcz), sumy dobowe producenta (kroki, dystans, kalorie total i aktywne), okna 10-minutowe UTC dla doby w strefie ustawienia (tętno, kalorie, kroki, dystans) i listy źródeł wpisów (tylko odczyt ręczny; odświeżanie automatyczne ich nie pobiera).
- **Warstwa pochodna** `google_page_windows`: sparsowane okna stron pod digestem strony i wersjonowaną nazwą parsera, zapisywane w tej samej transakcji co strona. Zmiana wyniku parsera to nowa nazwa (`@2`); stare wiersze są pomijane. Kolejność odczytu: pamięć procesu (limit 400 tys. okien) → warstwa pochodna → parsowanie oryginału.
- **Strefa doby:** ustawienie `day_zone_versions` (wersje, nigdy nadpisywane); każdy moduł z dostępem do bazy czyta strefę z magazynu (`readDayZone`), przeglądarka dostaje ją przed pierwszym renderem (`GET /api/settings/day-zone`), a zmianę wykonuje `DayZoneService` (nowa wersja + przeliczenie dób). Reguły: [kontrakty](data-contracts.md#strefa-doby-day-zone-v1).
- **Snapshoty dób:** wartości, statusy, uwagi i dowody jednej rewizji; notatki użytkownika z osobną historią (`user_note_versions`, pochodzenie z importów w `user_note_sources`).

`GoogleSyncService` (włączany zmienną środowiskową) wznawia niedokończone zadania, odświeża dobę bieżącą i trzy ostatnie zakończone, nadrabia do 13 dni przerwy, okresowo sprawdza ponownie starsze doby (rekonsyliacja: najdawniej zweryfikowane paczki, ważność zależna od wieku doby) i uruchamia uzupełnianie historii. Pokrycie historii trzyma w pamięci per rodzaj, z odciskiem ukończonych zadań, więc `/api/google/sync-status` jest tani. Projekcja snapshotów po odświeżeniu jest przyrostowa: pierwszy przebieg procesu liczy całe okno (rok, od 2026), kolejne tylko doby zmienionych zadań i decyzji CSV oraz doby od poprzedniej projekcji; każda doba jest liczona i publikowana w jednym kroku, więc wynik równa się pełnemu przeliczeniu (test `incremental-projection`). Ciężka praca oddaje pętlę zdarzeń między porcjami (31 dób, plik Takeout), nigdy wewnątrz transakcji. Połączenie tylko do odczytu czeka do 5 s na zatwierdzenie zapisu.

Brak: rejestru możliwości API, treningów, żywienia, AI/MCP, zapisu do dostawców, komponentu Android i dostępu spoza komputera.

## Granice i przepływ (docelowo)

```text
Health API ─┐
Takeout ────┼─> adaptery / importy ─> oryginały + wersje ─> normalizacja
Connect* ───┘                            │                    │
                                        │       reguły / kwalifikacja / repliki
                                        │                    │
Przeglądarka / przyszły Android / MCP ─> przypadki użycia ─> baza kanoniczna
                                               │              │
                                               │        tabela / wykresy / eksport
                                               v
                                   outbox ─> Health API / Connect*
                                  (* przez komponent Android)
```

Własna baza jest autorytatywna dla lokalnych wpisów, wyboru interpretacji i wyników aplikacji, ale nie zastępuje fizjologicznych modeli Google własnym algorytmem. Wynik producenta jest przechowywany osobno od pochodnych i korekt.

UI, REST i przyszły MCP wołają te same komendy domenowe. Adapter AI nie dostaje SQL, kluczy Google ani dostępu do plików. UI nie liczy kanonicznych sum inaczej niż serwer. Nowe typy API odkrywamy przez katalog możliwości ([plan API](plan/02-health-api.md)); wykresy mogą decymować dane do renderu, zachowując serie.

SQLite wystarcza dla jednego użytkownika; przy wielu hostach/użytkownikach ocenić PostgreSQL, bez dwóch baz od początku. Nie synchronizować otwartej bazy przez dysk chmurowy. Nie tworzyć pustych pakietów na zapas (`packages/ai` dopiero w M5–M6, `apps/android` w M8).

## Model trwałości (docelowo)

Część poniższego jest już zrealizowana konkretnymi tabelami (wyżej); reszta to model logiczny dla kolejnych etapów.

- `SourceAccount`, `SourceRecordVersion`, `RawArtifact`: źródło, konto (lokalny identyfikator, nie e-mail), oryginalne ID, czas/offset, wersja/hash, treść, czas pobrania.
- `Observation` / `Session` / `TimeSeries`: znormalizowane typy i jednostki z powiązaniem z oryginałem; duże serie porcjowane; osobny prywatny magazyn TCX/zdjęć.
- `ReplicaLink`, `IdentityDecision`, `Exclusion`: połączenia kopii z dowodem i wersją reguły. Podobny czas lub równa suma nie wystarczą do sklejenia.
- `MetricDefinition`, `CanonicalResult`, `DataIssue`: wartość, status, pokrycie i rewizja obejmująca uwagi.
- `UserEntryVersion`, `Correction`: własny zapis i historia; korekta nie niszczy źródła.
- `ImportSession`, `SyncCursor`, `Job`, `OutboxOperation`, `ExternalMapping`: plan, postęp, zakres ukończonego odczytu, zamiar publikacji, potwierdzenie i zdalne ID.
- Później: `ProductVersion`, `RecipeVersion`, `MealEntry`, `MealPlan`, `AiAnalysis` (plany żywienia i AI).

Transakcja obejmuje zapis oryginałów, checkpoint i unieważnienie projekcji; publikacja projekcji jest atomowa. HTTP nigdy wewnątrz transakcji. Outbox z trwałym idempotency key i stanami `pending/sending/uncertain/confirmed/conflict/failed`.

## Umiejscowienie i dostęp z telefonu

| Wariant | Zalety | Ograniczenia |
| --- | --- | --- |
| Lokalny serwis na PC (dziś) | Prosto, prywatne pliki | Komputer musi działać; telefon i ChatGPT nie widzą localhost |
| Ten sam serwis na prywatnym stałym hoście | Jedna baza, dostęp z telefonu, zadania bez UI | Utrzymanie, TLS/auth, kopie; VPN nie daje dostępu hostowi ChatGPT |
| Serwer zdalny | Najprostszy dostęp mobilny i REST/MCP | Koszt i odpowiedzialność za dane; migracja bazy |
| Prywatny serwis + tunel MCP ([OpenAI](https://developers.openai.com/plugins/deploy/connect-chatgpt)) | Narzędzia bez publicznego serwisu | Komputer/tunel musi działać; nie daje mobilnej strony |

Jeden właściciel bazy; przeniesienie na host to migracja, nie dwie kopie-master. Android może mieć szyfrowany cache i kolejkę z rewizją bazową. Wybór wariantu: [decyzje otwarte](decisions.md#decyzje-otwarte), [plan AI](plan/07-ai-chatgpt.md).
