# Środowisko developerskie

Przykład używa TypeScript, React i Vite, Node 24 LTS, wbudowanego `node:sqlite`, npm, Zod oraz test runnera Node przez tsx. Wersje bibliotek przypięto w `package.json` i `package-lock.json`. API nasłuchuje wyłącznie na 127.0.0.1. Tabela przykładowa korzysta z bazy w pamięci; osobna zakładka pokazuje surowe wiersze lokalnego importu Takeout, jeśli baza istnieje.

W systemie Windows można uruchomić `start-trivimo.cmd` poza środowiskiem izolowanym. Skrypt uruchamia serwer i interfejs w tle; stronę otwiera się pod `http://localhost:5173/`. Jeśli port jest zajęty, zgłasza problem i nie zatrzymuje innych procesów.

Alternatywnie w PowerShell, po zainstalowaniu Node 24:

```powershell
npm ci
npm run dev
```

W drugim terminalu w tym samym katalogu:

```powershell
npm run dev:web
```

Otwórz adres podany przez Vite i wybierz „Dane Takeout”. Zakładka służy do przeglądania danych. W „Import Takeout” można wkleić pełną ścieżkę rozpakowanego katalogu, sprawdzić podgląd i potwierdzić zapis; polecenia terminalowe poniżej pozostają alternatywą. Widok pokazuje oryginał i, dla znanych jednostek, dokładne przeliczenie bez kwalifikacji pomiaru. Filtr daty odnosi się do tekstu czasu w źródle, nie do doby Europe/Warsaw. `npm test` uruchamia testy syntetyczne, `npm run typecheck` sprawdza typy, a `npm run build` sprawdza typy i buduje interfejs.

Schemat przykładu ma wersję `user_version = 1` i powstaje w transakcji. Test sprawdza również syntetyczną bazę plikową, jej ponowne otwarcie oraz kopię przez SQLite backup API i odtworzenie do nowego pliku. Dane przykładowe pozostają w pamięci; magazyn importu jest osobnym plikiem. Funkcja kopii nie jest jeszcze podłączona do migracji i nie obejmuje załączników, szyfrowania ani polityki retencji; nie jest gotowym rozwiązaniem kopii danych zdrowia.

API sprawdza Host i Origin dla lokalnego adresu oraz Vite na porcie 5173, a dostęp wymaga lokalnego ciasteczka sesji `HttpOnly`/`SameSite=Strict`. Import przez UI wymaga dodatkowo jawnego Origin, nagłówka żądania oraz potwierdzenia przygotowanego planu. Nie ma jeszcze modelu dostępu zdalnego; nie udostępniaj serwisu w sieci. Wykres przykładu prezentuje abstrakcyjne wartości, nie metrykę medyczną.

## Lokalny import Takeout

Wskaż tylko wybrany, rozpakowany katalog eksportu. Bez wyszukiwania archiwów na dysku:

```powershell
npm run preview:takeout -- "C:\sciezka\do\eksportu"
npm run import:takeout -- "C:\sciezka\do\eksportu"
npm run verify:takeout
npm run verify:takeout -- "C:\chroniony-katalog\kopia.sqlite"
npm run backup:takeout -- "C:\chroniony-katalog\kopia.sqlite"
```

Na czas importu z terminala zamknij serwer; import w interfejsie wykonuje ten sam serwis. Import zachowuje pliki z katalogu Google Health; dla sześciu typów MVP dodatkowo odczytuje pola CSV i udostępnia ich surowy widok. Pozostałe pliki zachowuje bez interpretacji. Przed zapisem tworzy podgląd i trwały plan ze skrótami, zapisuje oryginalne bajty oraz pola jako tekst, zatwierdza każdy plik z checkpointem i wznawia niedokończony plan tylko przy niezmienionym pliku. Powtórzenie identycznych plików nie duplikuje ich treści. Wiersz jest pozycją w oryginalnym pliku, nie ustalonym ID pomiaru; różne pliki mogą zawierać kopie. Nie wylicza ani nie kwalifikuje wyników dziennych.

Magazyn `%LOCALAPPDATA%\Trivimo\takeout-raw.sqlite` jest poza repozytorium i nie jest szyfrowany przez aplikację. Polega na uprawnieniach i ochronie dysku systemu; nie ma jeszcze kompletnego mechanizmu szyfrowanych kopii. `verify:takeout` sprawdza integralność bazy, skróty oryginałów i liczbę zapisanych wierszy, nie zgodność znaczenia z Google Health. Rozpoznawane CSV wymagają UTF-8, maksymalnie 200 000 wierszy, 256 kolumn i 65 536 znaków na rekord; każdy plik jest ograniczony do 32 MiB, a cały plan do 5 000 plików. Import nie rozpakowuje ZIP i pomija napotkane linki symboliczne. Do większych eksportów potrzebne jest strumieniowanie i dalsza obsługa limitów.

Serwer oraz polecenia importu, weryfikacji i kopii używają tego samego katalogu. Opcjonalna zmienna `TRIVIMO_DATA_DIR` wskazuje katalog zawierający `takeout-raw.sqlite`. Jeśli środowisko izolowane nie ma dostępu do właściwej bazy, uruchom serwer w zwykłym terminalu użytkownika; przycisk „Spróbuj ponownie” ponawia odczyt bez restartu, gdy plik stanie się dostępny.

Polecenie kopii korzysta z SQLite backup API, wymaga nowej nazwy i nie nadpisuje istniejącego pliku; tworzy nieszyfrowaną kopię samej bazy. Wymaga docelowego systemu plików obsługującego dowiązania twarde. Wybierz odpowiednio chronioną lokalizację. Mechanizm kopii i odtwarzanie sprawdzono na syntetycznej bazie; wykonano i zweryfikowano także prywatną kopię w lokalizacji wskazanej przez użytkownika.

Opcjonalna próba starych parserów: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/spike-takeout.ps1`. Wymaga sąsiedniego kodu `C:\dev\health-sync`, lokalnego cache Gradle z Kotlin 2.0.21 i wskazanej w skrypcie Javy Android Studio. Test używa wyłącznie syntetycznych ciągów; nie jest częścią CI ani importem. Lokalny launcher obchodzi niezgodność rozpoznania JDK 25 przez starszy kompilator, bez zmiany JDK ani starego projektu.
