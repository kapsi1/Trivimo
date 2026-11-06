# Dashboardy, analiza aktywności i treningi

Po M1, iteracyjnie. Wzór funkcjonalny: Google Health, z wykorzystaniem dużego ekranu; bez kopiowania identycznego układu telefonu. Szczegółowy wygląd pozostaje do decyzji podczas rozwoju, początkowo prosty ciemny motyw.

## Preferencje widoku w bazie

Decyzja użytkownika 2026-11-06: stan kafelków i pozostałe opcje widoku są zapisywane w bazie aplikacji, żeby były takie same na desktopie i telefonie. Dziś kolumny i zakres tabeli oraz stan nawigacji leżą w `localStorage` przeglądarki ([UI](../design/ui.md)).

- [ ] Magazyn preferencji w bazie: wersjonowany klucz i wartość z rewizją, migracja i test odtworzenia z kopii. Obejmuje układ kafelków (Dzień, Trendy), kolumny, kolejność i szerokości kolumn tabeli, zakres, agregację i inne wybory widoku. Bez sekretów i bez wartości zdrowotnych.
- [ ] REST/UI czyta preferencje przy starcie, a zapisuje po zmianie z zachowaniem rewizji (konflikt dwóch urządzeń: ostatni zapis wygrywa, bez utraty pozostałych kluczy). Przywracanie domyślnych działa per widok.
- [ ] `localStorage` zostaje tylko pamięcią podręczną na czas ładowania i pracy bez serwera; jednorazowe przeniesienie dzisiejszych wartości do bazy bez nadpisania zapisanych już na serwerze.
- Wyjątek (decyzja 2026-11-06): zwinięcie lewej nawigacji (dotyczy tylko szerokiego ekranu) zostaje lokalne dla urządzenia, w przeglądarce.
- Zależność: telefon widzi te same preferencje dopiero, gdy ma dostęp do tego samego serwera i bazy ([plan 10](10-mobile.md#dostęp-i-wspólny-stan)).

## Widoki i wspólne interakcje

- [ ] Dashboard z wybranym dniem/tygodniem/miesiącem, kartami metryk, trendami i listą treningów; wspólna strefa/definicja daty. Zmiana zakresu aktualizuje tabelę i wykresy spójnie. Porównywanie okresów uwzględnia liczbę pełnych dni i pokrycie, bez pozornych średnich z braków.
- [ ] Tabela jak arkusz: zamrożona data/nagłówki, wybór/szerokości/kolejność kolumn, sortowanie/filtrowanie, kopiowanie i eksport. Najpierw odczyt, później edycja wyłącznie dozwolonych pól przez domenowe komendy; nie udawać dowolnej edycji pochodnych/sensorów.
- [ ] Szczegóły metryki: wykres historii oraz intraday, uwagi, dostępne pomiary i korekty. Bez panelu metadanych (źródła, model, definicja, identyfikatory) — decyzja 2026-11-06, zgodna z uproszczeniem UI z 2026-11-05; pochodzenie i diagnostyka zostają w „Źródłach danych”. Brak danych i celowo ukryty nieporównywalny wynik mają różne wyjaśnienia.
- [ ] Edycja kafelków na ekranach Dzień i Trendy: zmiana kolejności i wielkości kafelków oraz dodawanie i usuwanie ich z zestawu statystyk (np. dodanie metryki z API, ukrycie nieużywanej). Układ jest preferencją użytkownika zapisaną w bazie aplikacji (osobno dla Dzień i Trendy, wspólną dla desktopu i telefonu — zob. [preferencje](#preferencje-widoku-w-bazie)), z przywracaniem układu domyślnego; ukrycie kafelka nie usuwa danych ani nie zmienia definicji metryki. Wielkość kafelka zmienia tylko prezentację (miejsce na wykres), nie zakres ani rozdzielczość danych. Układ domyślny i minimalny rozmiar nie mogą ukrywać stanu „brak danych” ani oznaczeń jakości. Klawiatura i dostępność trybu edycji jak w pozostałych widokach, bez wymagania przeciągania myszą.
- [ ] Dzień: oprócz sześciu podstaw można dodać liczbę sesji, typy treningów, czas aktywny/łączny, strefy HR, AZM, poziomy aktywności, tętno spoczynkowe, sen/HRV/SpO₂ i regenerację w zakresie API. Kolumna „Treningi” to zwięzła projekcja listy; nie jedyne miejsce przechowywania sesji.
- [ ] Przydatne porównania: obciążenie tygodnia, rozkład czasu/stref, tempo/dystans/HR konkretnego sportu, relacja snu do aktywności. Rozdziel opis korelacji od wniosków przyczynowych. Zmiana algorytmu/urządzenia jest oznaczeniem na osi, nie niewidocznym skokiem.
- [ ] Dostępność nowych widoków: klawiatura, fokus, tekst alternatywny wykresu lub tabela danych, czytelność i kontrast. Nie uzależniać od najechania myszą. Użycie na telefonie: [plan 10](10-mobile.md).

## Sesje, intensywność i podział dnia

- [ ] Paginowana lista z filtrem sportu i zakresu (bez filtra źródła): nazwa/rodzaj, początek/koniec, czas aktywny i przerwy, dystans, kcal sesji, średnie HR i dostępne pola sportowe. Brak opcjonalnego pola nie blokuje szczegółów.
- [ ] Szczegóły: pasek podsumowania, timeline pauz/okrążeń, HR, tempo/prędkość/wysokość, strefy i mapa. Serie łączyć po przedziale, jednostkach i pochodzeniu, z oznaczeniem braków; HR globalne versus HR przypisane przez producenta do sesji rozróżnić.
- [ ] Intensywność nie jest jedną uniwersalną liczbą. Prezentować oddzielnie poziomy aktywności, czas w strefach HR, progi stref producenta i AZM. Nie zakładać równości AZM i minut ani stosować obecnych progów wieku do dawnego treningu. Lokalnie wyliczone strefy mają wersję algorytmu/progów i etykietę własnej pochodnej.
- [ ] Przed tym zakresem: strefy czasowe ([plan 02](02-health-api.md#strefy-czasowe)), bo granice doby i DST wpływają na podział sesji.
- [ ] Dla dnia z kilkoma treningami pokazać np. „2 × spacer, 1 × rower” i rozwijaną listę czasów/intensywności. Liczba sesji liczy sesje, a czas aktywności w dobie uwzględnia nakładanie i przecięcie z granicami dnia. Sesja przez północ pozostaje jedną sesją, choć jej czas wnosi wkład do dwóch dni.
- [ ] Nie dodawać kcal/steps/distance treningu do dziennego total źródła. Energia sesji jest osobnym polem o potwierdzonej definicji; przy sprzecznym opisie API oznaczyć niepewność. Nie rekonstruować modelu active kcal z samych stref/średniego HR.

[Przewodnik treningów](https://developers.google.com/health/data-types/workouts) opisuje sesję, pauzy i podsumowania liczbowe. [REST MetricsSummary](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints#MetricsSummary) jest niezależnym punktem sprawdzenia pól i ich opcjonalności.

## Trasy i wykresy

- [ ] Pobrać TCX per trening przez [exportExerciseTcx](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/exportExerciseTcx), dla HTTP z `alt=media`. Zweryfikować zarówno zakres aktywności, jak i lokalizacji; sprawdzić `partialData` przy braku GPS. Nie żądać lokalizacji w MVP bez map.
- [ ] Zachować oryginalny TCX prywatnie wraz z wersją/digestem i relacją do sesji. Parser XML bez zewnętrznych encji, z limitami i obsługą częściowych/błędnych danych. Zachować przerwy, brak GPS, dokładność czasu, jednostki i układ współrzędnych; nie rysować wymyślonej trasy między dużymi lukami.
- [ ] Mapa: dopasowanie widoku, początek/koniec, zoom/przesuwanie; opcjonalnie zsynchronizowany kursor mapy i wykresu. Wykres HR ze znanymi strefami, przerwy i okrążenia; tempo po odpowiedniej filtracji i oznaczeniu pochodnej. Decymacja do renderu nie zmienia podsumowań źródła.
- [ ] Wybrać dostawcę kafelków/licencję/billing. MapLibre lub Leaflet jest biblioteką, nie darmowym źródłem map. Publiczne kafelki OSM wymagają atrybucji i przestrzegania [polityki użycia](https://operations.osmfoundation.org/policies/tiles/); nie zakładać prawa do masowego pobierania/offline.
- [ ] Powiadomić o pobieraniu map zewnętrznych (obszar/IP); nie wysyłać całych tras do AI lub dodatkowych usług automatycznie. Eksport/udostępnienie i ukrywanie okolic domu jako osobne funkcje, domyślnie prywatnie.

## Podsumowania Google Health / Gemini

- [ ] Osobna próba możliwości: odnaleźć udokumentowany endpoint/pole tekstowego podsumowania, wersję, scopes, uprawnienia/plany, język i relację do treningu. Przeanalizowany publiczny schemat `metricsSummary` opisuje liczby, a nie tekstową narrację AI. Materiał „AI assistance” Google dotyczy pomocy deweloperowi, nie dowodzi udostępnienia podsumowań użytkownika.
- [ ] Jeśli dostępne: przechować tekst, autora/provider, język, czas i wersję powiązanych danych; pokazać jako oryginalne podsumowanie producenta. Nie pobierać go przez scraping prywatnego UI ani odwrotne analizowanie niepublicznego API.
- [ ] Jeśli brak publicznej ścieżki: funkcja ma jawny status niedostępnej w API; niczego nie wymyślać. Własne analizy [AI](07-ai-chatgpt.md) to odrębna funkcja i etykieta, nie „odzyskane Gemini”. Brak narracji nie blokuje treningu z liczbami/mapą.

## Odbiór

- [ ] Syntetyczne testy wielu sportów, braków, pauz, nakładania sesji, północy/DST, rozłącznych serii i jednostek, duplikatów autodetekcji/opaski, dużego TCX i błędnego XML.
- [ ] Test UI wydajności długiej historii oraz szczegółowej sesji i klawiatury (telefon: [plan 10](10-mobile.md)). Brak map/sieci nie blokuje istniejących danych sesji.
- [ ] Rzeczywisty wybrany trening porównany z dostępnymi statystykami Health; pokazać różnice definicji/zaokrągleń i brakujące pola, bez obietnicy zgodności całego UI.
