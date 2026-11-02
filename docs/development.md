# Środowisko developerskie

Pierwszy przykład P0 używa TypeScript, React i Vite, Node 24 LTS, wbudowanego `node:sqlite`, npm, Zod oraz test runnera Node przez tsx. Wersje bibliotek przypięto w `package.json` i `package-lock.json`. API nasłuchuje wyłącznie na 127.0.0.1. SQLite jest w pamięci i zawiera tylko syntetyczne rekordy, tworzone przy każdym uruchomieniu.

W PowerShell, po zainstalowaniu Node 24:

```powershell
npm ci
npm run dev
```

W drugim terminalu w tym samym katalogu:

```powershell
npm run dev:web
```

Otwórz adres podany przez Vite. `npm test` uruchamia test kontraktu i przepływu SQLite → HTTP, `npm run typecheck` sprawdza typy, a `npm run build` sprawdza typy i buduje interfejs.

To demonstracja, nie magazyn danych zdrowotnych: brak trwałej bazy, migracji, uwierzytelnienia, sesji, ochrony Origin/Host i importu. Nie używaj jej z prawdziwymi danymi ani nie udostępniaj z sieci. Wykres prezentuje abstrakcyjne wartości, nie metrykę medyczną.
