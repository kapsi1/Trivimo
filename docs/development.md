# Środowisko developerskie

Przykład używa TypeScript, React i Vite, Node 24 LTS, wbudowanego `node:sqlite`, npm, Zod oraz test runnera Node przez tsx. Wersje bibliotek przypięto w `package.json` i `package-lock.json`. API nasłuchuje wyłącznie na 127.0.0.1. Tabela przykładowa korzysta z bazy w pamięci; osobna zakładka pokazuje surowe wiersze lokalnego importu Takeout, jeśli baza istnieje.

W PowerShell, po zainstalowaniu Node 24:

```powershell
npm ci
npm run dev
```

W drugim terminalu w tym samym katalogu:

```powershell
npm run dev:web
```

Otwórz adres podany przez Vite i wybierz „Import Takeout”. `npm test` uruchamia testy syntetyczne, `npm run typecheck` sprawdza typy, a `npm run build` sprawdza typy i buduje interfejs.

Schemat przykładu ma wersję `user_version = 1` i powstaje w transakcji. Test sprawdza również syntetyczną bazę plikową, jej ponowne otwarcie oraz kopię przez SQLite backup API i odtworzenie do nowego pliku. Dane przykładowe pozostają w pamięci; magazyn importu jest osobnym plikiem. Funkcja kopii nie jest jeszcze podłączona do migracji i nie obejmuje załączników, szyfrowania ani polityki retencji; nie jest gotowym rozwiązaniem kopii danych zdrowia.

API sprawdza Host i Origin dla lokalnego adresu oraz Vite na porcie 5173, a odczyt wymaga lokalnego ciasteczka sesji `HttpOnly`/`SameSite=Strict`. Serwis udostępnia wyłącznie odczyt; nie ma jeszcze ochrony operacji zapisu ani modelu dostępu zdalnego. Nie udostępniaj go w sieci. Wykres przykładu prezentuje abstrakcyjne wartości, nie metrykę medyczną.

## Lokalny import Takeout

Wskaż tylko wybrany, rozpakowany katalog eksportu. Bez wyszukiwania archiwów na dysku:

```powershell
npm run preview:takeout -- "C:\sciezka\do\eksportu"
npm run import:takeout -- "C:\sciezka\do\eksportu"
npm run verify:takeout
npm run backup:takeout -- "C:\chroniony-katalog\kopia.sqlite"
```

Na czas importu zamknij serwer. Import zachowuje pliki z katalogu Google Health; dla sześciu typów MVP dodatkowo odczytuje pola CSV i udostępnia ich surowy widok. Pozostałe pliki zachowuje bez interpretacji. Przed zapisem tworzy podgląd i trwały plan ze skrótami, zapisuje oryginalne bajty oraz pola jako tekst, zatwierdza każdy plik z checkpointem i wznawia niedokończony plan tylko przy niezmienionym pliku. Powtórzenie identycznych plików nie duplikuje ich treści. Wiersz jest pozycją w oryginalnym pliku, nie ustalonym ID pomiaru; różne pliki mogą zawierać kopie. Nie wylicza ani nie kwalifikuje wyników dziennych.

Magazyn `%LOCALAPPDATA%\Trivimo\takeout-raw.sqlite` jest poza repozytorium i nie jest szyfrowany przez aplikację. Polega na uprawnieniach i ochronie dysku systemu; nie ma jeszcze kompletnego mechanizmu szyfrowanych kopii. `verify:takeout` sprawdza integralność bazy, skróty oryginałów i liczbę zapisanych wierszy, nie zgodność znaczenia z Google Health. Rozpoznawane CSV wymagają UTF-8, maksymalnie 200 000 wierszy, 256 kolumn i 65 536 znaków na rekord; każdy plik jest ograniczony do 32 MiB, a cały plan do 5 000 plików. Import nie rozpakowuje ZIP i pomija napotkane linki symboliczne. Do większych eksportów potrzebne jest strumieniowanie i dalsza obsługa limitów.

Polecenie kopii korzysta z SQLite backup API, wymaga nowej nazwy i nie nadpisuje istniejącego pliku; tworzy nieszyfrowaną kopię samej bazy. Wymaga docelowego systemu plików obsługującego dowiązania twarde. Wybierz odpowiednio chronioną lokalizację. Mechanizm kopii i odtwarzanie sprawdzono na syntetycznej bazie; kopia prywatnej bazy nie została wykonana automatycznie.

Opcjonalna próba starych parserów: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/spike-takeout.ps1`. Wymaga sąsiedniego kodu `C:\dev\health-sync`, lokalnego cache Gradle z Kotlin 2.0.21 i wskazanej w skrypcie Javy Android Studio. Test używa wyłącznie syntetycznych ciągów; nie jest częścią CI ani importem. Lokalny launcher obchodzi niezgodność rozpoznania JDK 25 przez starszy kompilator, bez zmiany JDK ani starego projektu.
