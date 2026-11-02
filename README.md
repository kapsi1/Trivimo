# Nowa aplikacja zdrowia i żywienia

Budujemy prywatną aplikację w przeglądarce na desktopie. Własna baza przechowuje oryginały, korekty i jednoznacznie zdefiniowane wyniki. Google Health API jest głównym bieżącym źródłem danych Google, Takeout źródłem historii, a Health Connect opcjonalnym źródłem i celem przez przyszły komponent Android. Żaden z tych transportów nie jest pełną kopią pozostałych.

## Pierwszy działający zakres

Masa ciała, procent tłuszczu, kroki, dystans, kalorie całkowite i aktywne; ciemny interfejs, tabela dni z kolumną „Uwagi”, podstawowe wykresy i szczegóły pochodzenia. Brak porównywalnych danych pozostaje brakiem. Sam BMR i zamienny szacunek telefonu nie wypełniają kalorii. Start od importu do własnej bazy i odczytu API; bez zapisów do chmury/Connect.

Docelowo: wszystkie odczytywalne dane Health API, dashboardy i treningi z tętnem/mapami, dostępne podsumowania producenta, dziennik i planer posiłków, import FatSecret, AI i współpraca z ChatGPT na telefonie. Rozwijamy to etapami według [planu](docs/plan/README.md).

## Jak zacząć pracę

1. Agent czyta [AGENTS.md](AGENTS.md), [architekturę](docs/architecture.md) i [kontrakty](docs/data-contracts.md).
2. Wybiera jeden etap w [indeksie planu](docs/plan/README.md); rozpoczęto P0, potem M1.
3. Sprawdza [decyzje i kwestie otwarte](docs/decisions.md), następnie źródła danego adaptera. Nie odczytuje całej dokumentacji automatycznie.
4. Rozdziela działający kod, test automatyczny i potwierdzenie prawdziwego konta/telefonu. Lokalny import zachowuje pliki Google Health, a sześć typów ma widok surowych wierszy; nie ma jeszcze dziennej projekcji ani połączenia z kontem.

Uruchomienie i ograniczenia przykładu opisuje [środowisko developerskie](docs/development.md), a wykonane kontrole [raport testów](docs/test-results.md).

[Indeks dokumentacji](docs/README.md) · [Etapy](docs/plan/README.md) · [Nazwy i sprawdzenie kolizji](docs/names.md) · [Źródła i ograniczenia weryfikacji](docs/references.md)

Nie przenosimy prywatnych eksportów, bazy, tokenów ani tras do tego katalogu/repozytorium. Starego arkusza posiłków nie obejmuje zgoda na wymianę tymczasowego arkusza zdrowia.
