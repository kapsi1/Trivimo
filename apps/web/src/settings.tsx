import type { ReactNode } from 'react';

const Row = ({ title, text, children }: { title: string; text: string; children: ReactNode }) => <div className="setrow"><div><strong>{title}</strong><p>{text}</p></div><div>{children}</div></div>;

/** Settings that exist today are shown as fixed values; changing them needs a versioned migration, not a toggle. */
export function SettingsView() {
  return <div className="settings">
    <section className="panel"><header><h3>Dzień i jednostki</h3></header>
      <Row title="Strefa dnia" text="Granice doby dla wszystkich widoków. Zmiana wymagałaby przeliczenia historii z wersją reguły, więc nie jest jeszcze dostępna."><span className="mono muted">Europe/Warsaw</span></Row>
      <Row title="Precyzja prezentacji" text="Masa 0,1 kg, tkanka tłuszczowa 0,1 %, dystans 0,01 km. Tylko prezentacja; wartości są przechowywane dokładnie."><span className="mono muted">0,1 kg · 0,1 % · 0,01 km</span></Row>
      <Row title="Pierwszy dzień tygodnia" text="Dla wierszy tygodni w tabeli i agregacji tygodniowej trendów (tydzień ISO)."><span className="muted">poniedziałek</span></Row></section>
    <section className="panel"><header><h3>Kopie zapasowe</h3></header>
      <Row title="Utworzenie kopii" text="Kopia spójnej bazy przez SQLite backup API do nowego pliku w chronionej lokalizacji poza repozytorium. Z interfejsu jeszcze niedostępne."><span className="mono muted">npm run backup:takeout -- &lt;ścieżka&gt;</span></Row>
      <Row title="Sprawdzenie odtworzenia" text="Kopiuje zamkniętą kopię do katalogu tymczasowego i przebudowuje projekcję dób z oryginałów."><span className="mono muted">npm run verify:restore -- &lt;ścieżka&gt;</span></Row></section>
    <section className="panel"><header><h3>Cele</h3><span className="tag food">M4</span></header><p className="sub" style={{ margin: 0 }}>Opcjonalne cele kalorii i makr, ustawiane świadomie. Pojawią się z planerem.</p></section>
    <section className="panel"><header><h3>Prywatność</h3></header>
      <Row title="Dane zdrowotne" text="Przechowywane lokalnie na tym komputerze. Przeglądarka nie widzi tokenów dostawców; interfejs i czcionki nie łączą się z zewnętrznymi serwerami."><span className="chip prov">lokalnie</span></Row></section>
  </div>;
}
