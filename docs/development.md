# Środowisko developerskie

TypeScript, React 19 + Vite 7, Node 24 LTS albo 26 LTS od 26.13 (wbudowany `node:sqlite`), Zod, testy przez test runner Node i tsx. Zależności instaluje **pnpm** (`pnpm-lock.yaml`; `package-lock.json` usunięto). API słucha wyłącznie na 127.0.0.1. Kroje pisma są lokalnymi plikami w `apps/web/src/fonts` (SIL OFL), bez Google Fonts.

## Uruchomienie

Windows: `start-trivimo.cmd` uruchamia serwer (port 3000) i interfejs (port 5173) w jednym oknie konsoli; strona: `http://localhost:5173/`. Ctrl+C zatrzymuje oba. Zajęty port jest zgłaszany; pozostałe procesy z poprzedniej sesji zatrzymuje `stop-trivimo.cmd`.

Ręcznie (dwa terminale):

```powershell
pnpm install
pnpm run dev       # serwer
pnpm run dev:web   # interfejs
```

Kontrole: `pnpm test` (testy syntetyczne), `pnpm run typecheck`, `pnpm run build` (typy + build Vite). Wyniki: [raport](test-results.md).

## Konfiguracja

Skopiuj `.env.example` do `.env` (poza gitem). Wczytują go serwer i skrypty CLI; zmienna z terminala ma pierwszeństwo. Ścieżki Windows bez cudzysłowu, w apostrofach albo z `/` (w cudzysłowie podwójnym `\n` staje się nową linią).

| Zmienna | Znaczenie |
| --- | --- |
| `TRIVIMO_GOOGLE_CLIENT_FILE` | Ścieżka do JSON klienta OAuth w prywatnym katalogu poza repozytorium (sekret zostaje w pliku) |
| `TRIVIMO_GOOGLE_SYNC_MINUTES` | 5–1440; włącza automatyczne odświeżanie przy starcie i co tyle minut |
| `TRIVIMO_DATA_DIR` | Katalog bazy; domyślnie `%LOCALAPPDATA%\Trivimo` |

Baza `takeout-raw.sqlite` leży w katalogu danych, obok `google-token.dpapi` i plików roboczych importu. Nie jest szyfrowana przez aplikację. Gdy bazy nie ma, serwer tworzy pustą w bieżącej wersji (zbudowaną i zweryfikowaną w katalogu tymczasowym); istniejącej nigdy nie zmienia. Test na czystej bazie: ustaw `TRIVIMO_DATA_DIR` na nowy katalog poza repozytorium (autoryzację Google trzeba wtedy wykonać osobno). Gdy środowisko izolowane nie widzi bazy, uruchom serwer w zwykłym terminalu; „Spróbuj ponownie” ponawia odczyt bez restartu.

## Migracje, kopia i odtworzenie

Serwer wymaga dokładnej wersji magazynu (dziś 13); inaczej serwer, odświeżanie i import zgłaszają „wymaga migracji”. Przy zatrzymanym serwerze:

```powershell
pnpm run migrate:canonical -- 'D:\Trivimo-bak\przed-vNN.sqlite'   # kopia + jeden krok migracji
pnpm run backup:takeout -- 'D:\chroniony-katalog\kopia.sqlite'     # kopia SQLite backup API, nowa nazwa
pnpm run verify:takeout [-- '<kopia.sqlite>']                       # integralność, skróty, liczby wierszy
pnpm run verify:restore -- '<kopia.sqlite>'                          # odtworzenie i przebudowa projekcji
```

Kopia wymaga ścieżki poza repozytorium, nie nadpisuje pliku i potrzebuje systemu plików z dowiązaniami twardymi. Jest nieszyfrowana i nie obejmuje tokenu Google, `.env` ani klienta OAuth — po odtworzeniu na innym koncie/komputerze trzeba ponownie autoryzować. `verify:restore` kopiuje zamkniętą kopię do pustego katalogu, sprawdza skróty, oryginały, łańcuchy stron Google i snapshoty oraz przebudowuje projekcję dób, która musi równać się opublikowanej; wypisuje tylko liczby i daty. Kolejną migrację dopisuje się w `apps/server/migrate-canonical.ts`.

## Google Health API

1. W kliencie OAuth (aplikacja internetowa) dodaj przekierowanie `http://127.0.0.1:3000/api/google/callback`.
2. Ustaw `TRIVIMO_GOOGLE_CLIENT_FILE`, uruchom serwer i interfejs.
3. „Źródła danych” → „Połączenia” → „Autoryzuj konto Google”. Ekran podaje liczbę przyznanych zakresów; częściowa zgoda nie jest pełnym dostępem.

Token dostępu jest tylko w pamięci serwera; token odświeżania w `google-token.dpapi` (Windows DPAPI, CurrentUser), odnawiany automatycznie. Odrzucenie przez Google usuwa zapis. Odłączenia konta w UI jeszcze nie ma.

**Odświeżanie** (zmienna `TRIVIMO_GOOGLE_SYNC_MINUTES`, przycisk „Odśwież teraz” albo kliknięcie stanu w stopce nawigacji): wznawia niedokończone zadania, czyta dobę bieżącą (co połowę interwału; masę i tkankę tłuszczową najwyżej raz na godzinę) i trzy ostatnie zakończone, po przerwie do 13 dni wstecz. Rodzajów odczytu jest 11, więc pełny przebieg to około 11 żądań; listy źródeł nie są pobierane. Zatrzymuje się na pierwszym błędzie; stan pokazuje tylko kody. Pojedyncze żądanie jest ponawiane przy 429 i przejściowym 503 (do 4 prób, `Retry-After` lub rosnący odstęp); trwały 429 wstrzymuje kolejne przebiegi do podanego czasu. Odczyty automatyczne podlegają [polityce odczytów](decisions.md#ustalenia-datowane); ręczne (`google:read`, panel „Odczyt próbny”) nie są usuwane. Gdy po przebiegu zostają nieodczytane doby od 2026-01-01, serwer sam uruchamia uzupełnianie historii (po ręcznym zatrzymaniu — dopiero po restarcie). Minioną dobę bez odczytu tabela oznacza uwagą o przerwie. **Starsze doby** (od początku okna projekcji do czwartej doby wstecz) sprawdza się ponownie okresowo — do 2 paczek na przebieg, najdawniej sprawdzane pierwsze, a ręczny przycisk „Sprawdź starsze doby” (`POST /api/google/sync` z `{"reconcile":true}`) czyta do 12 paczek niezależnie od ważności; różna treść zastępuje starszy odczyt z wierszem audytu, identyczna go potwierdza.

**Uzupełnianie historii** (panel w „Pokryciu historii”; `POST /api/google/backfill` z `{"action":"start","from":"RRRR-MM-DD"}` lub `{"action":"stop"}`; postęp w polu `backfill` stanu): te same rodzaje co odświeżanie, od 2026-01-01 lub wybranej daty (≥ 2000-01-01) do wczoraj, od najnowszych okresów. Doba jest pokryta, gdy pełny odczyt objął ją po jej końcu. Paczki: 13 dób dla okien 10-minutowych, 14 dla kalorii total, 7 dla list źródeł, 30 dla masy i tłuszczu, 90 dla pozostałych sum. Postęp liczony z bazy przeżywa restart, ale sam przebieg po restarcie serwera trzeba wznowić. Zatrzymanie kończy bieżącą paczkę i niczego nie cofa.

Ręczny odczyt zakresu (bez sekretów w kontekście agenta, wypisuje tylko status): `pnpm run google:read -- <rodzaj> <od> <do>`.

## Importy plików

**Takeout** („Źródła danych” → „Importy plików”): wybór jednego lub kilku plików .zip, podgląd, potwierdzenie. Archiwum trafia strumieniowo do `takeout-work/uploads` (`POST /api/takeout/upload`, do 64 GiB); `POST /api/takeout/zip-preview` rozpakowuje tylko folder „Google Health” (limity: 5000 plików, 32 MiB na plik, 4 GiB razem, współczynnik kompresji 1000; odrzuca `..`, ścieżki absolutne, dowiązania, szyfrowanie i złe CRC-32; ZIP64 obsługiwany). Po udanym imporcie pliki robocze są usuwane; przerwany import wznawia ponowny wybór tych samych archiwów.

Z terminala, przy zatrzymanym serwerze, dla rozpakowanego katalogu (bez wyszukiwania archiwów po dysku):

```powershell
pnpm run preview:takeout -- 'C:\sciezka\do\eksportu'
pnpm run import:takeout -- 'C:\sciezka\do\eksportu'
```

Import zachowuje bajty wszystkich plików Google Health, a dla sześciu typów MVP także pola CSV (surowy widok, bez kwalifikacji). Ma trwały plan ze skrótami i checkpoint per plik; powtórzenie nie duplikuje treści. Wiersz to pozycja w pliku, nie ID pomiaru. Limity CSV: UTF-8, 200 000 wierszy, 256 kolumn, 65 536 znaków na rekord.

**CSV z mapowaniem kolumn** (ta sama zakładka): wybór pliku (≤ 8 MiB), mapowanie daty, godziny, metryk, jednostek, uwag i separatorów, podgląd z liczbami i odrzuceniami, zapis; lista importów pozwala je wycofać i przywrócić. Token podglądu wiąże tekst pliku, mapowanie i wersję parsera. Reguły: [`csv-fill-v1`](data-contracts.md#reguła-csv-fill-v1--import-csv-2026-11-04).

## REST

Wszystkie punkty wymagają lokalnego ciasteczka sesji (`GET /api/session`, `HttpOnly`, `SameSite=Strict`) i kontroli Host/Origin; POST dodatkowo nagłówka `X-Trivimo-Request`. Główne grupy (lista w `apps/server/app.ts`):

- Dni: `/api/day`, `/api/day-range`, `/api/earliest-days`, `POST /api/day/note`.
- Google: `/api/google/status|start|callback`, `sync-status`, `POST sync`, `POST backfill`, `coverage?year=`, `jobs`, `daily-candidates`, `body-candidates`, `band-share`, `band-share-range`, `day-series`, `heart-rate`, `heart-rate-range`, `energy-forecast`.
- Importy: `/api/takeout/upload|zip-preview|preview|import`, `/api/source-account/*`, `/api/source-records`, `/api/csv/inspect|preview|import|decision|imports|day`.

## Dane rzeczywiste

Eksport Takeout do pracy leży w `test-data/` (poza gitem); zasady odczytu: [plan](plan/README.md#dane-rzeczywiste-w-pracy-deweloperskiej). Kopie przed migracjami (jedna na wersję) są w `D:\Trivimo-bak`. Jednorazowe skrypty analizy nie są w repozytorium; wnioski: [obserwacje](completed/03-data-findings.md).
