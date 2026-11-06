# Trivimo

Prywatna aplikacja zdrowia i żywienia w przeglądarce na desktopie. Własna baza przechowuje oryginały, korekty i jednoznacznie zdefiniowane wyniki. Google Health API jest głównym bieżącym źródłem danych Google, Takeout źródłem historii, a Health Connect opcjonalnym źródłem i celem przez przyszły komponent Android. Żaden z tych transportów nie jest pełną kopią pozostałych.

## Stan

M1 wykonane (2026-11-06; eksport CSV, kopia z UI i telefon przeniesione do [etapu Q](docs/plan/09-quality-operations.md)): masa ciała, tkanka tłuszczowa, kroki, dystans, kalorie całkowite i aktywne z Google Health API (od 2026-01-01, starsze lata na żądanie), import Takeout i CSV, widoki Dzień, Tabela dni i Trendy, odświeżanie w tle, kopia i odtworzenie. Brak porównywalnych danych pozostaje brakiem, sam BMR nie wypełnia kalorii. Bez zapisów do chmury/Connect.

Docelowo: wszystkie odczytywalne dane Health API, treningi z tętnem i mapami, dziennik i planer posiłków, import FatSecret, AI i wpisy przez ChatGPT na telefonie — etapami według [planu](docs/plan/README.md).

## Start

- Uruchomienie: `start-trivimo.cmd` albo [środowisko developerskie](docs/development.md).
- Agent: [AGENTS.md](AGENTS.md), potem [indeks dokumentacji](docs/README.md).

Prywatnych eksportów, bazy, tokenów ani tras nie przenosimy do repozytorium.
