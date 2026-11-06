import { useState, type ReactNode } from 'react';
import { dayZoneSchema, post, useJson } from './api.ts';
import { whenOf } from './format.ts';

const Row = ({ title, text, children }: { title: string; text: string; children: ReactNode }) => <div className="setrow"><div><strong>{title}</strong><p>{text}</p></div><div>{children}</div></div>;

/**
 * The day zone is a stored setting with a rule version. Changing it recomputes the published days from the saved
 * originals as new revisions (the previous revisions stay in the history); days without a complete reading in the new
 * zone stay empty until their windows are read again, never zero. The page reloads afterwards.
 */
function DayZoneRow() {
  const state = useJson('/api/settings/day-zone', dayZoneSchema);
  const [choice, setChoice] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  if (!state.data) return <Row title="Strefa doby" text="Granice doby dla wszystkich widoków."><span className="muted">{state.error ? 'niedostępna (brak bazy lub migracji)' : 'ładowanie…'}</span></Row>;
  const { zone, staleDays, zones, history } = state.data, selected = choice ?? zone, resume = staleDays > 0 && selected === zone;
  const apply = async () => {
    const ok = resume || window.confirm(`Zmienić strefę doby z ${zone} na ${selected}?

Doby zostaną przeliczone z zapisanych oryginałów jako nowe wersje (poprzednie zostają w historii). Doby bez pełnego odczytu w nowej strefie będą puste do ponownego odczytu okien — to brak danych, nie zero.`);
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      const response = await post('/api/settings/day-zone', { zone: selected });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; setError(body.error === 'sync_running' ? 'Trwa odświeżanie lub uzupełnianie historii; spróbuj po jego zakończeniu.' : 'Nie udało się zmienić strefy.'); setBusy(false); return; }
      location.reload();
    } catch { setError('Nie udało się zmienić strefy.'); setBusy(false); }
  };
  return <Row title="Strefa doby" text={`Granice doby, okna 10-minutowe, „dziś”, prognoza i godziny we wszystkich widokach (reguła ${state.data.rule}). Zmiana przelicza opublikowane doby z zapisanych oryginałów.${history.length > 1 ? ` Zmieniono ${history.length - 1}×; ostatnio ${whenOf(history.at(-1)!.createdAt)}.` : ''}`}>
    <div className="rowend">
      <select aria-label="Strefa doby" value={selected} disabled={busy} onChange={(event) => setChoice(event.target.value)}>{zones.map((item) => <option key={item} value={item}>{item}</option>)}</select>{' '}
      <button type="button" className="btn" disabled={busy || (selected === zone && staleDays === 0)} onClick={() => void apply()}>{busy ? 'Przeliczanie…' : resume ? 'Dokończ przeliczanie' : 'Zmień strefę'}</button>
    </div>
    {staleDays > 0 && <p className="sub" role="status">{staleDays} z {state.data.days} dób ma jeszcze wersję z innej strefy; „Dokończ przeliczanie” je odświeży.</p>}
    {error && <p className="sub" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
  </Row>;
}

/** Settings that are not editable yet are shown as fixed values; changing them needs a versioned migration, not a toggle. */
export function SettingsView() {
  return <div className="settings">
    <section className="panel"><header><h3>Dzień i jednostki</h3></header>
      <DayZoneRow />
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
