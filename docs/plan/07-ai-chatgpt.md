# AI, ChatGPT na telefonie i narzędzia aplikacji

Cel: zachować możliwość „opowiadam o posiłku w ChatGPT na telefonie → wpis trafia do naszej bazy”, a także umożliwić własne analizy treningów/żywienia. AI nie jest źródłem prawdy o pomiarach ani etykietach produktów. Najpierw stabilne komendy dziennika i REST; MCP jest cienkim adapterem tych samych funkcji.

## Wybór kanału mobilnego — próba przed pełną budową

| Wariant | Co umożliwia | Co trzeba rozstrzygnąć |
| --- | --- | --- |
| Mobilna przeglądarka / później PWA | Własny formularz, aparat/upload i dostępne wejście głosowe, jedna logika web | Uwierzytelniony dostęp do serwera; PC localhost nie działa z telefonu; wsparcie uprawnień/audio zależy od klienta |
| ChatGPT Android + custom MCP/plugin | Najbliżej obecnej rozmowy; model wyszukuje produkty i wywołuje komendy zapisu | Konto/plan/polityki, obsługa w konkretnym kliencie mobilnym, auth, zdjęcia/głos i dostęp do serwera; sprawdzić realną sesję |
| ChatGPT + REST, np. obsługiwany mechanizm akcji/integracji | Potencjalna alternatywa, gdy wybrany klient daje takie narzędzia | Sam prompt z URL nie daje modelowi dostępu. Zweryfikować aktualne wsparcie i auth; nie budować legacy integracji na założeniu |
| Dedykowany Android | Kamera, mikrofon, kolejka offline i Connect w jednej aplikacji | Większy koszt i utrzymanie; nie jest wymagany, jeśli web/ChatGPT spełnia potrzeby |

Rekomendacja projektowa: REST i responsywny formularz jako niezależny fundament; MCP jako preferowany eksperyment dla istniejącego sposobu pracy ChatGPT. **Nie przenoś użytkownika do własnego czatu bez porównania wariantów.** Brak obsługi mobilnego MCP wymaga wskazania działającej alternatywy i uzgodnienia jej wygody.

[OpenAI opisuje](https://developers.openai.com/plugins/deploy/connect-chatgpt) połączenie ChatGPT z MCP przez publiczny HTTPS lub Secure MCP Tunnel, z ograniczeniami konta/workspace. To potwierdza wariant prywatnego serwera, ale nie stanowi dowodu działania na konkretnym telefonie użytkownika. Dokumentacja [Responses API MCP](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) dotyczy także wywołań przez naszą aplikację; nie utożsamiać ich z możliwościami mobilnego klienta ChatGPT.

- [ ] Spike na syntetycznych danych: połącz konto, wywołaj wyszukiwanie i przygotowanie szkicu, dodaj posiłek, odczytaj potwierdzenie i popraw ilość na telefonie. Sprawdź kontynuację obecnej rozmowy versus konieczność nowej, dostęp zdjęcia/głosu do narzędzia i wygaśnięcie sesji.
- [ ] Powtórz żądanie, przerwij sieć i wyłącz PC/host. Wynik ma być jednoznaczny: zapisany ID i rewizja albo oczekujący/niezapisany. ChatGPT nie może ogłosić sukcesu bez odpowiedzi aplikacji. Wznowienie po awarii nie dubluje wpisu.
- [ ] Wybierz host według [architektury](../architecture.md). Tunel wymaga działającego procesu i dostępu w koncie; nie jest magazynem posiłków, gdy PC jest wyłączony. Jeśli wymagany zapis zawsze, potrzebny stale dostępny host albo jawna trwała kolejka z odbiorem. Nie utrzymywać dwóch baz-master.

## Kontrakt REST/MCP

Proponowane przypadki użycia, nie gotowe endpointy:

- `search_products(query, barcode?, limit)`: małe wyniki ID/wersja/porcja/makra/źródło, według hierarchii [katalogów](06-food-sources.md).
- `prepare_meal(items, localDate, time?, mealType?)`: szkic, sumy, braki i niejednoznaczności; bez dopisania do spożycia.
- `commit_meal(draftId, expectedRevision, idempotencyKey)`: zapis zgodny z intencją użytkownika, potwierdzone ID, rewizja i wynik. Żądanie „dodaj” może autoryzować zapis kompletnego sprawdzonego szkicu; nie wymuszaj drugiej zgody przy każdym posiłku.
- `get_meal`, `list_meals`, `update_meal`, `delete_meal`: zakres konta, wersja i historia. Niejasny produkt/ilość wymaga wyjaśnienia; duża destrukcyjna zmiana ma podgląd. Zwykła korekta konkretnego wpisu nie wymaga dodatkowej ceremonii.
- `get_day_summary`, `get_workout_context`: minimalny potrzebny zakres danych i jakość. Brak dowolnego SQL, uploadu całej bazy, sekretów dostawców i arbitralnego URL-fetch/file-read.

- [ ] Zaimplementować te same walidacje i uprawnienia dla UI, REST i MCP. Walidacja na serwerze, typed inputs/outputs, kody błędów, limity wielkości i czasu, prywatne scope np. meal:write versus health:read. AI nie dziedziczy uprawnień administracyjnych całej aplikacji.
- [ ] Dla MCP wybrać standardowy transport i deklaracje narzędzi read-only/destructive/idempotent zgodne z rzeczywistym zachowaniem. Annotations nie zastępują serwerowego auth. Preferować dojrzały serwer autoryzacji zamiast tworzenia własnego protokołu.
- [ ] Zweryfikować [wymagania OAuth MCP OpenAI](https://developers.openai.com/plugins/build/auth), discovery i PKCE oraz izolację issuer/audience/scopes. To autoryzacja do naszej aplikacji, odrębna od Google OAuth. Nie przesyłać tokena Health do ChatGPT ani nie używać go jako sesji naszej bazy.
- [ ] Prompt rozmowy zawiera reguły jednostek/niepewności i użycia narzędzi, lecz backend nadal chroni inwarianty. Zewnętrzna nazwa produktu/strona/zdjęcie nie może nadpisać instrukcji i wymusić zapisu lub wysłania historii.

## Tekst, głos i zdjęcia

- [ ] Tekst: rozpoznaj produkty, ilości, stan surowy/gotowany i porcje, użyj katalogów, pytaj o istotne braki. Znany produkt nie wymaga LLM do pobrania wartości. Użytkownik widzi źródło/wersję i może poprawić rozpoznanie.
- [ ] Głos: transkrypcja → ten sam szkic/komendy, z możliwością poprawy. Porównaj dyktowanie systemowe/ChatGPT i własny upload/transkrypcję, koszty i wsparcie polskiego. Nie zapisuj surowego audio domyślnie na zawsze.
- [ ] Zdjęcie etykiety: odczyt wartości/barcode z walidacją jednostek i zgodności produktu. Zdjęcie talerza: propozycja składników i niepewnych ilości, nie precyzyjna etykieta; istotne porcje potwierdzić. Obsłuż kilka zdjęć, duplikaty i konflikt z katalogiem. Usuń zbędne EXIF/lokalizację przed wysłaniem, gdy nie są potrzebne.
- [ ] Jeśli mobilny ChatGPT nie udostępnia binarnych załączników narzędziu, nie zakładaj, że istnieją po stronie serwera. Ustal przepływ przez ustrukturyzowany wynik rozmowy albo własny bezpieczny upload; adres pliku musi mieć krótki zakres/czas i właściwe auth.
- [ ] Osobne ustawienia retencji zdjęć/audio, provider i zakres wysyłanych danych. Można odrzucić materiał po ekstrakcji, zachowując zaakceptowane wartości i ich pochodzenie. Bez domyślnego wysyłania tras/całej historii do modelu.

## Analizy i dostawcy

- [ ] M6 treningi: kontekst sesji, HR/strefy, pauzy, pokrycie i porównywalne poprzednie treningi. Generuj opis oparty na dostępnych liczbach z odniesieniem do okresu, bez dopowiadania brakującego GPS, spalania lub przyczyn zdrowotnych. Producentowe Gemini i własna analiza to osobne typy.
- [ ] Żywienie: bilans z jakością/pokryciem, regularność i zgodność z podanymi celami, sugestie posiłków/planów. Oddziel tekst porady, propozycję planu i komendę zapisu. Analiza nie dodaje automatycznie jedzenia do dziennika.
- [ ] Port provider-neutral: tekst, vision, transkrypcja i narzędzia jako capabilities, nie obowiązek identycznych funkcji u każdego LLM. Pierwszy dostawca po wyborze użytkownika, ustawienia modelu po stronie serwera; możliwość kolejnych dostawców bez migracji posiłków.
- [ ] Zapis analizy: provider/model, promptVersion, dataRevision, zakres wejść, czas, status, koszt/usage jeśli dostępne i tekst. Cache po zgodnej wersji wejść/prompcie; stare analizy oznaczać po korekcie danych. Nie wysyłać tych samych serii ponownie tylko przez odświeżenie UI.
- [ ] Budżet per zadanie/dzień, minimalny kontekst, ustrukturyzowane wyniki i liczenie wywołań. Nie zakładaj, że subskrypcja ChatGPT pokrywa wywołania API naszej aplikacji; sprawdzić aktualne rozliczenia/ewentualne uprawnienia dla wybranego wariantu. Sekrety modeli nigdy w przeglądarce.

## Odbiór

- [ ] Zestaw syntetycznych scenariuszy polskich posiłków: niejasna porcja, dwie identyczne kanapki jako oddzielne wpisy, ten sam request ponowiony, błędna data, brak katalogu, korekta poprzedniego wpisu, usunięcie, prompt injection i odmowa uprawnień.
- [ ] Realny potwierdzony workflow ChatGPT Android lub świadomie wybrany zamiennik, z opisem ograniczeń zdjęć/głosu/hosta. Sam MCP Inspector i test z desktopu nie potwierdzają telefonu.
- [ ] Własne AI może być wyłączone bez utraty dziennika i wykresów. Niedostępny model nie niszczy szkicu/zapisanego wpisu. Koszty i prywatność sprawdzone na małej próbce przed automatyzacją.
