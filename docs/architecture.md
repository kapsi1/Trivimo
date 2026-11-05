# Architektura docelowa

Projekt, nie opis implementacji. Decyzje użytkownika: [rejestr](decisions.md); semantyka: [kontrakty](data-contracts.md).

Zaimplementowano lokalny magazyn oryginalnych plików Google Health i surowych wierszy sześciu typów oraz wersjonowany magazyn wyników dnia. Syntetyczny przepływ od jawnych dowodów do REST i widoku opisano w [raporcie](test-results.md). Inne pliki są zachowane bez interpretacji; rzeczywiste wiersze nie są jeszcze kwalifikowane ani automatycznie przeliczane na wyniki dnia.

Magazyn jest w wersji 13 (migracje 5→12 wykonano na właściwej bazie, każdą po kopii na dysku wskazanym przez użytkownika; wersja 11 dodaje tabele importu CSV `csv_imports`, `csv_import_values`, `csv_import_decisions`; wersja 12 dodaje `csv_import_notes` (uwagi importu per doba) i `user_note_sources` (która rewizja notatki dnia pochodzi z którego importu), aby wycofanie importu obejmowało też notatki; wersja 13 dodaje warstwę pochodną `google_page_windows` — sparsowane okna 10-minutowe każdej zapisanej strony okien pod digestem strony i wersjonowaną nazwą parsera — oraz indeks stron po digeście). Warstwa pochodna nie jest źródłem prawdy: powstaje w tej samej transakcji co oryginalna strona, znika razem z ostatnią stroną, która jej potrzebuje, a weryfikacja magazynu sprawdza, że każdy wiersz równa się wynikowi parsera na oryginale i że żadnej strony okien nie brakuje. Zmiana wyniku parsera to nowa wersja nazwy (`@2`); wiersze starej wersji są wtedy pomijane, a odczyt parsuje oryginał. Wersje magazynu sprawdza jedna funkcja `storeHas(version, since)`. Odczyt Google Health API zapisuje oryginalne strony odpowiedzi w zadaniach (`google_read_jobs`, `google_read_pages`) z kursorem wznowienia i kontrolą konta po skrócie identyfikatora. Rodzaje zadań: pomiary (waga, tłuszcz), sumy dobowe producenta (kroki, dystans, kalorie total i aktywne; doby cywilne producenta) oraz okna 10-minutowe w czasie UTC dla doby warszawskiej (tętno, kalorie total i aktywne, kroki, dystans). Wersja 9 dodaje `google_read_job_meta` (pochodzenie zadania, skrót treści, potwierdzenia „bez zmian”) i `google_read_supersessions` (audyt zastąpionych odczytów); polityka porządkowania jest w [decyzjach](decisions.md).

Serwer wykonuje odczyty także samodzielnie (`GoogleSyncService`: odświeżanie dzisiejszej doby i trzech ostatnich zakończonych dób, nadrabianie przerwy, wznowienie niedokończonych zadań; włączane zmienną środowiskową). Pokrycie historii (postęp uzupełniania, kalendarz roku) serwis trzyma w pamięci per rodzaj i zakres, z odciskiem ukończonych zadań danego rodzaju (liczba, najnowszy i zsumowany czas utworzenia, suma rowid); każde dodane, ukończone lub usunięte zadanie przelicza tylko swój rodzaj. Dzięki temu częste odpytywanie `/api/google/sync-status` nie blokuje serwera. Po każdym odświeżeniu projekcja snapshotów jest przyrostowa: pierwszy przebieg procesu przelicza całe okno (rok, od 2026), kolejne tylko doby zadań dodanych, ukończonych lub usuniętych oraz importów CSV o zmienionej decyzji od ostatniej udanej projekcji, a także doby od dnia poprzedniej projekcji do dziś (doba w toku zmienia się z czasem). Każda doba jest liczona i publikowana w jednym kroku, więc wynik jest taki sam jak przy pełnym przeliczeniu (test `incremental-projection`). Ciężka praca w wątku serwera oddaje pętlę zdarzeń między porcjami: projekcja i publikacja zakresu po 31 dób (`publishDayRangeYielding`, także w imporcie CSV), plan i import Takeout po każdym pliku (generator kroków; wersje synchroniczne dla CLI i testów), nigdy wewnątrz transakcji. Sparsowane strony okien 10-minutowych są czytane z pamięci procesu (pod digestem SHA-256 treści strony, limit 400 tys. okien), potem z warstwy pochodnej magazynu, a dopiero na końcu parsowane z oryginału, a granice dób Warszawy pod datą; połączenie tylko do odczytu czeka do 5 s na zatwierdzenie zapisu innego połączenia zamiast od razu zwracać błąd. Warstwa odczytu z zapisanych stron jest osobna od kwalifikacji: widok dnia i tabela pokazują kandydatów, udział opaski (okna z tętnem) i serie godzinowe, a snapshoty kanoniczne nadal nie są liczone z danych Google. Stan prac i następne kroki M1: [plan](plan/README.md#stan-m1-i-następne-kroki).

## Granice i przepływ

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

Własna baza jest autorytatywna dla lokalnych wpisów, wyboru interpretacji i wyników aplikacji. Nie oznacza zastąpienia fizjologicznych modeli Google własnym algorytmem. Zachowujemy oryginalny wynik producenta osobno od naszych pochodnych i korekt. API/Takeout mogą przedstawiać ten sam oryginał; Connect może zawierać jego kopię albo pomiar innej aplikacji.

## Proponowany stos i układ

Rekomendacja na P0: modułowy monolit TypeScript, React + Vite, mały serwer Node z REST, SQLite i jawne migracje. Jeden właściciel zapisu bazy, zadania importu/synchronizacji wykonywane przez ten serwis. Wersje LTS i biblioteki wybrać oraz przypiąć przy inicjalizacji; nie są już wybrane przez ten plan. Brak mikroserwisów, brokera, Kubernetes i własnego frameworka agentowego na start.

Powód: jeden język kontraktów web/serwer/narzędzi AI, lokalne uruchomienie i kopie, prosta droga do serwera. SQLite jest propozycją dla prywatnego jednoosobowego użycia. Przy wielu jednoczesnych użytkownikach/hostach ponownie ocenić PostgreSQL; nie implementować dwóch baz od pierwszego dnia. Nie synchronizować otwartej bazy przez dysk chmurowy.

Proponowany układ kodu po zatwierdzeniu P0:

| Katalog | Odpowiedzialność |
| --- | --- |
| `apps/web` | Tabele, dashboard, szczegóły, responsywny formularz posiłku |
| `apps/server` | Uwierzytelnienie, REST, zadania, składanie adapterów, jeden zapis DB |
| `packages/domain` | Definicje, jednostki, kwalifikacja, kalendarz, konflikty i komendy; bez UI/HTTP |
| `packages/contracts` | Wersjonowane wejścia/wyjścia, walidacja i błędy; bez sekretów |
| `packages/storage` | Migracje, repozytoria, transakcje i kopie |
| `packages/adapters` | Health, Takeout, żywność, FatSecret; osobne moduły i checkpointy |
| `packages/ai` | Port dostawcy, budowanie kontekstu, cache analiz i budżety |
| `apps/android` | Dopiero M8: Connect, parowanie, lokalna kolejka i ewentualny klient |

Nie twórz pustych pakietów dla całej tabeli od razu. P0 wybiera minimalny układ i standardy. Parserów Kotlin z Health Sync nie można wkleić do TS: najpierw wyodrębnić reguły i syntetyczne testy. Kotlin/JVM z React jest alternatywą, jeśli próba wykaże znaczną oszczędność na parserach. Nie przenosić platformowych Room/Compose/URI/zgód ani powiązania import→Connect→Sheets.

## Model trwałości

To model logiczny; konkretny schemat ustala M1:

- `SourceAccount`, `SourceRecordVersion`, `RawArtifact`: źródło, konto, oryginalne ID, czas/offset, wersja/hash, treść i schemat, pochodzenie oraz czas pobrania. Konto to prywatny lokalny identyfikator, nie e-mail w logach.
- `Observation` / `Session` / `TimeSeries`: znormalizowane typy i jednostki, powiązanie z oryginałem, bez utraty nieobsługiwanych pól. Duże serie porcjowane; osobny prywatny magazyn załączników/TCX/zdjęć.
- `ReplicaLink`, `IdentityDecision`, `Exclusion`: połączenia kopii, dowód/pewność, wersja reguły i ręczne decyzje. Podobny czas lub równa suma doby nie wystarczają do automatycznego sklejenia.
- `MetricDefinition`, `CanonicalResult`, `DataIssue`: polityka źródeł i dnia, wartość, jednostka, status jakości, pokrycie i rewizja. Rewizja wyniku obejmuje także uwagi i powiązania.
- `UserEntryVersion`, `Correction`: własny zapis i historia zmian; korekta nie niszczy treści źródłowej.
- `ImportSession`, `SyncCursor`, `Job`, `OutboxOperation`, `ExternalMapping`: zamrożony plan, postęp, zakres ukończonego odczytu, zamiar publikacji, potwierdzenie i zdalne ID.
- Później: `ProductVersion`, `RecipeVersion`, `MealEntry`, `MealPlan`, `AiAnalysis`; szczegóły w planach żywienia i AI. Produkty OFF mają oddzielny magazyn pochodzenia/licencji.

Transakcja: zapis oryginałów + checkpoint porcji + unieważnienie/przeliczenie dotkniętych projekcji. Publikacja projekcji atomowa: wartości i uwagi tej samej rewizji. Długiego HTTP nie wykonuj wewnątrz transakcji. Outbox z trwałym idempotency key i stanem `pending/sending/uncertain/confirmed/conflict/failed`; restart może wymagać sprawdzenia zdalnego wyniku.

## Umiejscowienie i dostęp z telefonu

| Wariant | Zalety | Ograniczenia i zastosowanie |
| --- | --- | --- |
| Lokalny serwis na PC, loopback | Prosty start, prywatne pliki, brak hostingu | Komputer musi działać; telefon i zdalne narzędzia nie mają dostępu do jego localhost |
| Ten sam serwis na prywatnym stale dostępnym hoście | Jedna baza i dostęp z telefonu, zadania bez otwartego UI | Utrzymanie, TLS/auth, kopie i bezpieczna łączność; VPN nie gwarantuje dostępu hosta ChatGPT |
| Serwer zdalny aplikacji | Najprostsza dostępność mobilna i REST/MCP | Koszt i odpowiedzialność za dane; migracja bazy i plików, żadnego publicznego dostępu do DB |
| Prywatny serwis + tunel MCP | Możliwa integracja narzędzi bez publicznego serwisu | Dostępność klienta/tunelu/konta do potwierdzenia, komputer/agent tunelu musi działać; nie zastępuje dostępu mobilnej strony |

Tunel do ChatGPT jest opisany w [dokumentacji OpenAI](https://developers.openai.com/plugins/deploy/connect-chatgpt). Wybranie go nie rozwiązuje automatycznie mobilnego dostępu do całej aplikacji ani działania po wyłączeniu PC. Nie wdrażamy teraz tunelu/serwera. M5 wymaga konkretnej decyzji z [planu AI](plan/07-ai-chatgpt.md).

Domyślnie jeden właściciel bazy. Przeniesienie na host jest migracją, a nie dwiema niezależnymi kopiami-master. Android może mieć szyfrowany cache i kolejkę poleceń, z rewizją bazową do wykrycia konfliktów. Późniejszy offline-first z wieloma właścicielami to osobny koszt, nie założenie MVP.

## Adaptery i projekcje

UI, REST i MCP wołają te same komendy i zapytania domenowe. Adapter AI nie dostaje dowolnego SQL, kluczy Google ani bezpośredniego dostępu do plików. Zdjęcia/serie wysyła wyłącznie przez wybrany zakres funkcji. UI nigdy nie przelicza samodzielnie kanonicznych sum inaczej niż serwer.

Typy API odkrywamy przez katalog możliwości, nie przez sztywną tabelę sześciu metryk. Każdy odczytywalny typ ma co najmniej bezpieczny ogólny widok struktury, źródła i czasu, a docelowo odpowiednią tabelę/szczegóły. Metryki wyłącznie zapisywalne nie stają się sztucznie odczytywalne; patrz [API](plan/02-health-api.md). Wydajne wykresy korzystają z jawnych agregatów/decymacji do wizualizacji, zachowując oryginalne serie.
