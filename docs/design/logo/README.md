# Logo Trivimo

Znak: jabłko z wyciętą linią pulsu (jedzenie i trening). Zatwierdzone przez użytkownika 2026-11-04.

| Plik | Zastosowanie |
| --- | --- |
| `trivimo-mark.svg` | sam znak na ciemne tło (tło przezroczyste) |
| `trivimo-mark-light.svg` | sam znak na jasne tło |
| `trivimo-logo.svg` | znak z napisem „Trivimo” na ciemne tło |
| `trivimo-logo-light.svg` | znak z napisem na jasne tło |

Kolory:

| Element | Ciemne tło | Jasne tło |
| --- | --- | --- |
| jabłko („wiśnia”) | `#d63c4f` | `#c9304a` |
| ogonek i liść („bazylia”) | `#4fb069` | `#3d8f53` |
| napis | `#e4eaef` | `#0e1317` |

Puls jest wycięty maską, więc przyjmuje kolor tła. Napis to Bricolage Grotesque 600 (SIL OFL), osadzony w plikach `trivimo-logo*.svg` jako podzbiór latin. Dlatego te pliki mają około 100 KB i nie potrzebują zainstalowanego fontu.

W interfejsie znak rysuje `LogoMark` z `apps/web/src/logo.tsx` (ta sama geometria, kolory z `--logo-apple` i `--logo-leaf`). Pojawia się w nagłówku lewego panelu i w `Loading`, które zastępuje tekst „Ładowanie…”. W `Loading` puls rysuje się od lewej jak zapis EKG i znika w prawo, a jabłko uderza raz na cykl trwający 1,8 s. Przy `prefers-reduced-motion: reduce` znak tylko łagodnie pulsuje przezroczystością. Wskaźnik ma 100 × 100 px i zmniejsza się, gdy miejsce jest węższe. Wariant w linii tekstu ma 16 px. Wskaźnik pojawia się po 150 ms, więc szybkie odczyty nie migają. Czytnik ekranu dostaje „Ładowanie…” przez `role="status"`.

Pliki aplikacji w `apps/web/public/`: `favicon.svg` (kopia znaku na ciemne tło), `favicon.ico` (16, 32 i 48 px), `apple-touch-icon.png` (180 px), `icon-192.png`, `icon-512.png` i `icon-maskable-512.png` na tle `#0e1317` oraz `manifest.webmanifest`. Pliki PNG i ICO zostały wyrenderowane z `favicon.svg` w Chrome bez interfejsu. Po zmianie znaku trzeba je wygenerować ponownie.
