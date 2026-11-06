# Telefon i wspólny stan widoku

Decyzja użytkownika 2026-11-06: zadania dotyczące używania aplikacji na telefonie mają osobny plan. Dziś: układ poniżej 860 px z dolnym paskiem i listą kart dni poniżej 640 px, sprawdzony tylko w emulacji 375 px przeglądarki aplikacji ([UI](../design/ui.md)). Telefon nie ma dostępu do serwera na `127.0.0.1`.

## Dostęp i wspólny stan

- [ ] Telefon korzysta z tego samego serwera i tej samej bazy co desktop. Wymaga rozstrzygnięcia decyzji „Zdalny dostęp i stale dostępny serwer” oraz „Uwierzytelnienie poza 127.0.0.1” ([decyzje](../decisions.md#decyzje-otwarte)); do tego czasu telefonu nie da się sprawdzić na prawdziwym urządzeniu.
- [ ] Preferencje widoku (kafelki, kolumny, zakres) czytane z bazy, nie z przeglądarki telefonu: [preferencje w bazie](04-ui-workouts.md#preferencje-widoku-w-bazie). Test: zmiana na desktopie jest widoczna na telefonie po odświeżeniu i odwrotnie.

## Widoki na telefonie

- [ ] Podstawowy odczyt nowych widoków M2 ([plan 04](04-ui-workouts.md)): dashboard, lista treningów i szczegóły sesji. Duża tabela może mieć widok kart lub listy; szczegóły sesji pokazują podsumowanie, strefy i wykres z tabelą danych.
- [ ] Zamiast najechania myszą: dotyk (wartość po dotknięciu wykresu), ten sam sens co tooltip. Cele dotykowe, rozmiar tekstu i kontrast w ciemnym motywie.
- [ ] Edycja kafelków na dotyk bez przeciągania (przyciski w górę/w dół, rozmiar, dodaj/usuń), z tymi samymi regułami co na desktopie.
- [ ] Mapa trasy na telefonie: przesuwanie i powiększanie bez blokowania przewijania strony; po wyborze dostawcy kafelków ([plan 04](04-ui-workouts.md#trasy-i-wykresy)).
- [ ] Mobilne wprowadzanie jedzenia: responsywny formularz dziennika jest w [planie żywienia](05-nutrition.md), kanał ChatGPT w [planie AI](07-ai-chatgpt.md).

## Odbiór

- [ ] Widok telefonu sprawdzony na rzeczywistym telefonie (dziś tylko emulacja 375 px w przeglądarce aplikacji). Test automatyczny ani emulacja nie potwierdzają telefonu.
- [ ] Test UI telefonu: wąski ekran (375 px) dla widoków M2 i długiej historii, klawiatura ekranowa, orientacja pozioma, wydajność listy i szczegółów sesji.
