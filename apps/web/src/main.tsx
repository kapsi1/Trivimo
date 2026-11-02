import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { daysSchema, type Day } from '../../../packages/contracts/day.ts';
import { sourcePageSchema, type SourceKind, type SourcePage } from '../../../packages/contracts/source-records.ts';
import './style.css';

function App() {
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'demo' | 'source'>('source');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/session', { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error('Sesja');
      return fetch('/api/days', { signal: controller.signal });
    })
      .then((response) => { if (!response.ok) throw new Error('API'); return response.json(); })
      .then((data: unknown) => setDays(daysSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  return <main>
    <p className="eyebrow">TRIVIMO · P0</p><h1>Dane</h1>
    <nav aria-label="Widok"><button type="button" aria-current={tab === 'demo' ? 'page' : undefined} onClick={() => setTab('demo')}>Przykład</button><button type="button" aria-current={tab === 'source' ? 'page' : undefined} onClick={() => setTab('source')}>Import Takeout</button></nav>
    {tab === 'source' && days && <SourceRecords />}
    {tab === 'demo' && <p>Przykład: wyłącznie dane syntetyczne, bez połączenia ze źródłem zdrowia.</p>}
    {error ? <p role="alert">Nie udało się pobrać danych. Sprawdź, czy serwer działa.</p> : !days ? <p>Ładowanie…</p> : <>
      {tab === 'demo' && <>
      <div className="table-wrap"><table><thead><tr><th>Data</th><th>Wartość przykładowa</th><th>Uwagi</th></tr></thead>
        <tbody>{days.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.value === null ? <span title="Brak pomiaru">—</span> : day.value.toLocaleString('pl-PL')}</td><td>{day.note || '—'}</td></tr>)}</tbody></table></div>
      <h2>Wykres przykładowy</h2><p>Każdy słupek pokazuje pojedynczą wartość; brak nie jest zerem.</p>
      <div className="chart" aria-label="Wartości przykładowe według daty">{days.map(day => <div className="bar-row" key={day.date}><span>{day.date}</span><div className="track">{day.value !== null && <div className="bar" style={{ width: `${day.value}%` }} />}</div><span>{day.value === null ? 'brak' : day.value.toLocaleString('pl-PL')}</span></div>)}</div>
      </>}
    </>}
  </main>;
}

const kinds: { value: SourceKind; label: string; unit: string }[] = [
  { value: 'weight', label: 'Masa ciała', unit: 'g' },
  { value: 'body_fat', label: 'Tkanka tłuszczowa', unit: '%' },
  { value: 'steps', label: 'Kroki', unit: 'szt.' },
  { value: 'distance', label: 'Dystans', unit: 'm' },
  { value: 'total_energy', label: 'Kalorie', unit: 'według eksportu' },
  { value: 'active_energy', label: 'Energia aktywności', unit: 'kcal według eksportu' },
];

function SourceRecords() {
  const [kind, setKind] = useState<SourceKind>('weight');
  const [page, setPage] = useState<SourcePage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    fetch(`/api/source-records?kind=${kind}&after=${cursor}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Źródło'); return response.json(); })
      .then((data: unknown) => setPage(sourcePageSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, cursor]);
  const unit = kinds.find((item) => item.value === kind)?.unit;
  return <section><h2>Oryginały z Takeout</h2>
    <p>Surowe wiersze eksportu. Nie są jeszcze uzgodnione, odfiltrowane ani przeliczone na wyniki dnia; mogą zawierać kopie. Pozostałe pliki Google Health zachowano jako oryginały, ale ich zawartość nie ma jeszcze podglądu.</p>
    <label>Rodzaj danych <select value={kind} onChange={(event) => { setKind(event.target.value as SourceKind); setCursor(0); setHistory([]); setPage(null); }}>
      {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    {error ? <p role="alert">Nie udało się odczytać importu. Sprawdź, czy baza istnieje i jest dostępna.</p> : loading || !page ? <p>Ładowanie…</p> : page.rows.length === 0 ? <p>Brak wierszy tego typu w imporcie.</p> : <>
      <div className="table-wrap"><table><thead><tr><th>Czas źródła</th><th>Wartość ({unit})</th><th>Źródło według eksportu</th></tr></thead>
        <tbody>{page.rows.map((row, index) => <tr key={`${cursor}-${index}`}><td>{row.timestamp || '—'}</td><td>{row.value || '—'}</td><td>{row.source || '—'}</td></tr>)}</tbody></table></div>
      {history.length > 0 && <button type="button" onClick={() => { setCursor(history.at(-1)!); setHistory(history.slice(0, -1)); }}>Poprzednie</button>}
      {page.next !== null && <button type="button" onClick={() => { setHistory([...history, cursor]); setCursor(page.next!); }}>Następne 100</button>}
    </>}
  </section>;
}

createRoot(document.getElementById('root')!).render(<App />);
