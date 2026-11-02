# Dziennik, produkty, receptury i planer

Po stabilnym M1; pierwsza użyteczna wersja M3 działa ręcznie bez LLM i bez FatSecret API. Baza aplikacji jest właścicielem nowych wpisów. [Źródła i migracja](06-food-sources.md), [wprowadzanie AI/ChatGPT](07-ai-chatgpt.md) korzystają z tych samych kontraktów.

## Produkty i wartości

- [ ] Model produktu: nazwa, marka, kod kreskowy/identyfikatory zewnętrzne, kraj/język, wartości na 100 g / 100 ml / porcję, wielkość porcji, jednostki, źródło, data i wersja. Nie przeliczaj ml na g bez znanej gęstości; „sztuka” wymaga masy/porcji albo pozostaje nieprzeliczalna.
- [ ] Energia, białko, tłuszcz, węglowodany jako rdzeń; opcjonalnie błonnik, cukry, nasycone, sól/sód i dalsze składniki z jawnie określonym znaczeniem. Brak ≠ 0; jednostki i precyzja z etykiety. Nie wymuszaj idealnej równości kcal z przelicznikiem makr przy zaokrągleniach/błonniku/poliolach.
- [ ] Produkt użytkownika, zewnętrzny snapshot, prywatna korekta i oszacowanie AI to różne pochodzenia. Edycja etykiety tworzy wersję. Wyszukiwanie preferuje zaakceptowane produkty użytkownika, ale pozwala porównać źródła; nie scala różnych smaków/wariantów na podstawie podobnej nazwy.
- [ ] Receptura: składniki z konkretnymi wersjami i ilościami, gotowa masa/wydajność, liczba porcji i opcjonalna instrukcja. Gotowanie/ubytek wody nie zmienia automatycznie wszystkich składników. Niepełny składnik oznacza częściowe makra receptury, bez ukrytego zerowania.

## Dziennik i spójne komendy

- [ ] Wpis ma ID, datę lokalną, opcjonalny czas/offset, typ posiłku/nazwę, składniki/ilości i snapshot wartości w chwili zapisu. Brak godziny w importowanym raporcie pozostaje brakiem; nie twórz rzeczywistej pory z arbitralnego południa.
- [ ] Historia nie zmienia się po poprawieniu produktu/receptury. Przeliczenie dawnych posiłków wymaga jawnej operacji, podglądu i rewizji. Zachować oryginalne wartości importu obok późniejszych korekt.
- [ ] REST/UI: wyszukaj produkt, przygotuj szkic posiłku, waliduj i pokaż sumy/braki, zapisz, odczytaj po ID, popraw przy zgodnej rewizji, anuluj szkic, usuń lub wycofaj wpis. Stabilne idempotency key oraz expected revision, bez podwójnego zapisu po ponowieniu telefonu/AI.
- [ ] Szkic ≠ zjedzony posiłek. Jawne pole stanu; sumy dnia obejmują tylko zapisane spożycie. Niewystarczające ilości/porcje wymagają uzupełnienia; można zapisać świadomie niepełny wpis, ale sumy mają oznaczenie częściowych.
- [ ] Ekran dnia: chronologiczna lista, suma posiłku/dnia, pokrycie składników, kopiowanie wpisu i szybka korekta. Wspólne „Uwagi” dla braków/konfliktów żywienia, z prywatnymi notatkami osobno. Nawodnienie osobny strumień i jednostki.
- [ ] Wykresy żywienia obok aktywności z ostrożnym opisem bilansu: szacowane kcal spożyte i wydatek mają niepewność; brak wydatku nie tworzy pełnego bilansu. Nie przedstawiać pozornego deficytu dla dnia BMR-only.

## Planer M4

- [ ] Planowane dni/posiłki, produkty/receptury, ilości i szacowane sumy; kopiowanie i przesuwanie. Plan jest osobny od dziennika i nie trafia do Health/Connect jako spożyty.
- [ ] „Zjadłem” tworzy wpis dziennika ze snapshotem i relacją do planu. Powtórzenie tej komendy nie tworzy duplikatu; korekta ilości po zjedzeniu nie edytuje historycznie całego planu.
- [ ] Cele kcal/makr opcjonalne i wprowadzane świadomie; lista zakupów może być późniejszą pochodną. AI może proponować plan na podstawie jawnych preferencji, ale nie zapisuje go automatycznie jako zjedzony.
- [ ] Responsywny formularz dziennika stanowi bazę mobilnego wprowadzania nawet wtedy, gdy MCP/ChatGPT jest niedostępny. Nie wymaga natywnego Androida.

## Odbiór

- [ ] Testy jednostek, porcje/gęstość, stan surowy/gotowany, zmiany receptury, nieznane makra, zaokrąglenia i dane z różnych źródeł.
- [ ] Testy szkic→zapis→korekta/usunięcie, idempotencja, konflikt dwóch klientów, daty/DST i import bez godziny. Stara wersja produktu nie znika spod wpisu.
- [ ] Testy plan→spożycie, wielokrotna komenda, plan bez wpływu na dzienne spożycie/publikację. Ręczny wpis działa offline względem katalogów zewnętrznych, gdy lokalny serwis jest dostępny.
- [ ] Eksport/kopia odtwarzają produkty, wersje, przepisy, historię i relacje do importów. Przyszła publikacja Nutrition nie może podwoić posiłków z zaimportowaną sumą dnia.
