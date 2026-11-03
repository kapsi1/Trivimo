import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { daysSchema, type Day } from '../../../packages/contracts/day.ts';
import { bodyReviewSchema, sourcePageSchema, type SourceKind, type SourcePage } from '../../../packages/contracts/source-records.ts';
import { dayResponseSchema, userNoteSchema } from '../../../packages/contracts/day-snapshot.ts';
import { z } from 'zod';
import './style.css';

function App() {
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'demo' | 'source' | 'import' | 'overview'>('source');
  const [overviewDirty, setOverviewDirty] = useState(false);
  const [overviewBusy, setOverviewBusy] = useState(false);
  useEffect(() => {
    if (!overviewDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [overviewDirty]);
  function changeTab(next: typeof tab) {
    if (tab === 'overview' && next !== tab && overviewDirty && !window.confirm('Notatka ma niezapisane zmiany. Opuścić widok?')) return;
    if (next !== tab) setOverviewDirty(false);
    setTab(next);
  }
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
    <nav aria-label="Widok"><button type="button" disabled={overviewBusy} aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => changeTab('overview')}>Przegląd</button><button type="button" disabled={overviewBusy} aria-current={tab === 'source' ? 'page' : undefined} onClick={() => changeTab('source')}>Dane Takeout</button><button type="button" disabled={overviewBusy} aria-current={tab === 'import' ? 'page' : undefined} onClick={() => changeTab('import')}>Import Takeout</button><button type="button" disabled={overviewBusy} aria-current={tab === 'demo' ? 'page' : undefined} onClick={() => changeTab('demo')}>Przykład</button></nav>
    {tab === 'source' && days && <SourceRecords />}
    {tab === 'import' && days && <TakeoutImport onComplete={() => setTab('source')} />}
    {tab === 'overview' && days && <DailyOverview dirty={overviewDirty} busy={overviewBusy} onDirty={setOverviewDirty} onBusy={setOverviewBusy} />}
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

type DayResponse = z.infer<typeof dayResponseSchema>;
const dailyMetrics = [
  ['weight', 'Masa ciała', 'kg', 2], ['body_fat', 'Tkanka tłuszczowa', '%', 2],
  ['steps', 'Kroki', 'szt.', 0], ['distance', 'Dystans', 'km', 2],
  ['total_energy', 'Spalone kalorie', 'kcal', 0], ['active_energy', 'Aktywne kalorie', 'kcal', 0],
] as const;
const quality: Record<string, string> = { valid: 'Potwierdzony', provisional: 'Częściowy', missing: 'Brak danych', incomplete: 'Niepełne dane', incomparable: 'Nieporównywalne', conflict: 'Konflikt danych', stale: 'Nieaktualny', unsupported: 'Nieobsługiwane', permission_denied: 'Brak uprawnień', source_error: 'Błąd źródła' };

function formatRational(value: { numerator: string; denominator: string }, decimals: number): string {
  const divisor = BigInt(value.denominator), scale = 10n ** BigInt(decimals);
  const rounded = (BigInt(value.numerator) * scale + divisor / 2n) / divisor;
  const integer = (rounded / scale).toString();
  return decimals === 0 ? integer : `${integer},${(rounded % scale).toString().padStart(decimals, '0')}`;
}

function warsawToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function DailyOverview({ dirty, busy, onDirty, onBusy }: { dirty: boolean; busy: boolean; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void }) {
  const [date, setDate] = useState(warsawToday);
  const [response, setResponse] = useState<DayResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!date) { setResponse(null); return; }
    const controller = new AbortController();
    setError(false); setResponse(null);
    fetch(`/api/day?date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((result) => { if (!result.ok) throw new Error('Dzień'); return result.json(); })
      .then((data: unknown) => setResponse(dayResponseSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [date]);
  return <section><h2>Przegląd dnia</h2>
    <label>Data <input type="date" value={date} disabled={busy} onChange={(event) => { if (dirty && !window.confirm('Notatka ma niezapisane zmiany. Zmienić datę?')) { event.currentTarget.value = date; return; } onDirty(false); setDate(event.target.value); }} /></label>
    <p>Dzień aplikacji: Europe/Warsaw.</p>
    {!date ? <p>Wybierz datę.</p> : error ? <p role="alert">Nie udało się odczytać wyniku dnia.</p> : !response ? <p>Ładowanie…</p> : response.state === 'not_ready' ? <p>Wyniki dzienne nie są jeszcze przygotowane. Oryginalne dane znajdziesz w zakładce „Dane Takeout”.</p> : <>
      {!response.snapshot ? <p>Brak obliczonego wyniku dla wybranej daty.</p> : <><div className="table-wrap"><table><thead><tr><th>Metryka</th><th>Wartość</th><th>Stan</th></tr></thead><tbody>
        {dailyMetrics.map(([key, label, unit, decimals]) => { const metric = response.snapshot!.metrics[key]; return <tr key={key}><td>{label}</td><td>{metric.value === null ? '—' : `${formatRational(metric.value, decimals)} ${unit}`}</td><td>{quality[metric.status]}</td></tr>; })}
      </tbody></table></div>
      <h3>Uwagi</h3>{response.snapshot.notes.length ? <ul>{response.snapshot.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>Brak uwag.</p>}
      </>}
      <BodyCandidates key={`body-${date}`} date={date} />
      {response.notesAvailable && <UserNoteEditor key={`note-${date}`} date={date} initial={response.userNote} onDirty={onDirty} onBusy={onBusy} />}
    </>}
  </section>;
}

function BodyCandidates({ date }: { date: string }) {
  const [kind, setKind] = useState<'weight' | 'body_fat'>('weight');
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<z.infer<typeof bodyReviewSchema> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setResult(null); setError(false);
    fetch(`/api/body-candidates?kind=${kind}&date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Dane'); return response.json(); })
      .then((data: unknown) => setResult(bodyReviewSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [date, kind, visible]);
  return <div><h3>Pomiary źródłowe w tym dniu</h3>
    <p>To kandydaci przypisani do dnia warszawskiego. Ich tożsamość i kompletność nie zostały jeszcze potwierdzone, więc nie tworzą automatycznie średniej.</p>
    {!visible ? <button type="button" onClick={() => setVisible(true)}>Pokaż pomiary</button> : <>
      <label>Rodzaj <select value={kind} onChange={(event) => setKind(event.target.value as 'weight' | 'body_fat')}><option value="weight">Masa ciała</option><option value="body_fat">Tkanka tłuszczowa</option></select></label>
      {error ? <p role="alert">Nie udało się odczytać pomiarów źródłowych.</p> : !result ? <p>Ładowanie…</p> : <>
        {result.unassigned > 0 && <p>Niektórych czasów źródłowych nie udało się przypisać do dnia.</p>}
        {result.rows.length === 0 ? <p>Nie znaleziono pomiarów dla wybranej daty; kompletność źródła jest nieznana.</p> : <>
          <div className="table-wrap"><table><thead><tr><th>Czas źródła</th><th>Oryginał</th><th>Po przeliczeniu</th><th>Źródło</th></tr></thead><tbody>
            {result.rows.map((row, index) => <tr key={index}><td>{row.timestamp}</td><td>{row.originalValue || '—'}</td><td>{row.converted.status === 'parsed' ? `${row.converted.value.replace('.', ',')} ${row.converted.unit}` : 'Nie można przeliczyć'}</td><td>{row.origin || 'Nieznane'}</td></tr>)}
          </tbody></table></div>
          {result.truncated && <p>Pokazano 200 z {result.matched} wierszy.</p>}
        </>}
      </>}
    </>}
  </div>;
}

function UserNoteEditor({ date, initial, onDirty, onBusy }: { date: string; initial: z.infer<typeof userNoteSchema> | null; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void }) {
  const [draft, setDraft] = useState(initial?.content ?? '');
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const dirty = draft !== (saved?.content ?? '');
  async function save() {
    setSaving(true); onBusy(true); setError(''); setSuccess(false);
    try {
      const response = await fetch('/api/day/note', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: JSON.stringify({ date, content: draft, expectedRevision: saved?.revision ?? null }) });
      if (response.status === 409) throw new Error('Notatka zmieniła się w innym oknie. Skopiuj swój tekst przed odświeżeniem.');
      if (!response.ok) throw new Error('Nie udało się zapisać notatki.');
      const note = userNoteSchema.parse(await response.json());
      setSaved(note); onDirty(false); setSuccess(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Nie udało się zapisać notatki.'); }
    finally { setSaving(false); onBusy(false); }
  }
  return <div className="user-note"><h3>Moja notatka</h3>
    <label>Notatka dla wybranego dnia <textarea value={draft} maxLength={10000} disabled={saving} onChange={(event) => { const next = event.target.value; setDraft(next); onDirty(next !== (saved?.content ?? '')); setSuccess(false); }} /></label>
    <button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Zapisywanie…' : 'Zapisz notatkę'}</button>
    {error && <p role="alert">{error}</p>}{success && <p role="status">Notatka zapisana.</p>}
  </div>;
}

function TakeoutImport({ onComplete }: { onComplete: () => void }) {
  const [path, setPath] = useState('');
  const [preview, setPreview] = useState<{ token: string; files: number; rows: number; resuming: boolean; accountLinked: boolean } | null>(null);
  const [accountAvailable, setAccountAvailable] = useState(false);
  const [unassignedImports, setUnassignedImports] = useState(0);
  const [accountPreview, setAccountPreview] = useState<{ count: number; token: string } | null>(null);
  const [accountDone, setAccountDone] = useState(false);
  const [sameAccount, setSameAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/source-account', { signal: controller.signal }).then((response) => response.ok ? response.json() : null)
      .then((data: unknown) => { if (typeof data === 'object' && data !== null) { if ('singleExistingAccount' in data) setAccountAvailable(data.singleExistingAccount === true); if ('unassignedImports' in data && typeof data.unassignedImports === 'number') setUnassignedImports(data.unassignedImports); } })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  async function submit(endpoint: 'preview' | 'import', body: object) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/takeout/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: JSON.stringify(body) });
      const data: unknown = await response.json();
      if (!response.ok) {
        const code = typeof data === 'object' && data !== null && 'error' in data ? data.error : '';
        throw new Error(code === 'pending_other' ? 'Niedokończony import dotyczy innego katalogu. Wskaż jego pierwotny katalog, aby go wznowić.' : code === 'pending_account_locked' ? 'Wznawiany plan nie miał przypisanego konta; odznacz wybór, aby zachować jego zapisane decyzje.' : code === 'account_unavailable' ? 'Nie można jednoznacznie wybrać wcześniejszego konta.' : code === 'plan_changed' ? 'Pliki lub stan importu zmieniły się. Przygotuj podgląd ponownie.' : code === 'preview_expired' ? 'Podgląd wygasł. Przygotuj go ponownie.' : code === 'invalid_directory' ? 'Podaj pełną ścieżkę do katalogu.' : code === 'no_files' ? 'Nie znaleziono plików Google Health w tym katalogu.' : code === 'unsupported_schema' ? 'Eksport zawiera nieobsługiwany układ kolumn.' : code === 'invalid_csv' ? 'Eksport zawiera nieprawidłowy plik CSV lub nieobsługiwane kodowanie.' : 'Nie udało się odczytać katalogu lub zapisać danych. Sprawdź ścieżkę i dostęp serwera.');
      }
      if (endpoint === 'preview') {
        if (typeof data !== 'object' || data === null || !('token' in data) || typeof data.token !== 'string' || !('files' in data) || typeof data.files !== 'number' || !('rows' in data) || typeof data.rows !== 'number' || !('resuming' in data) || typeof data.resuming !== 'boolean' || !('accountLinked' in data) || typeof data.accountLinked !== 'boolean') throw new Error('Nieprawidłowa odpowiedź serwera.');
        setPreview({ token: data.token, files: data.files, rows: data.rows, resuming: data.resuming, accountLinked: data.accountLinked });
      } else { setDone(true); setPreview(null); try { const state = await fetch('/api/source-account'); if (state.ok) { const account = await state.json() as { unassignedImports?: number }; if (typeof account.unassignedImports === 'number') setUnassignedImports(account.unassignedImports); } } catch { /* Import was already committed. */ } }
    } catch (failure) { setError(failure instanceof TypeError ? 'Nie można połączyć się z serwerem aplikacji.' : failure instanceof Error ? failure.message : 'Nie udało się wykonać operacji.'); if (endpoint === 'import') setPreview(null); }
    finally { setBusy(false); }
  }
  async function assignAccount(confirm: boolean) {
    setBusy(true); setError(''); setAccountDone(false);
    try {
      const response = await fetch(`/api/source-account/${confirm ? 'assign' : 'preview'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: JSON.stringify(confirm ? { token: accountPreview?.token } : {}) });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error('Nie udało się przypisać importów. Przygotuj podgląd ponownie.');
      if (!confirm) {
        if (typeof data !== 'object' || data === null || !('count' in data) || typeof data.count !== 'number' || !('token' in data) || (data.token !== null && typeof data.token !== 'string')) throw new Error('Nieprawidłowa odpowiedź serwera.');
        setUnassignedImports(data.count);
        setAccountPreview(data.token ? { count: data.count, token: data.token } : null);
      } else {
        setAccountPreview(null); setAccountDone(true);
        try { const state = await fetch('/api/source-account');
          if (state.ok) { const account = await state.json() as { unassignedImports?: number }; if (typeof account.unassignedImports === 'number') setUnassignedImports(account.unassignedImports); }
        } catch { /* Assignment was already committed. */ }
      }
    } catch (failure) { setAccountPreview(null); setError(failure instanceof Error ? failure.message : 'Nie udało się przypisać importów.'); }
    finally { setBusy(false); }
  }
  return <section className="import-panel"><h2>Import Google Takeout</h2>
    <p>Podaj pełną ścieżkę do rozpakowanego katalogu na tym komputerze. Aplikacja najpierw przygotuje podgląd; zapis rozpocznie się po Twoim potwierdzeniu.</p>
    <label>Ścieżka katalogu <input type="text" value={path} disabled={busy} onChange={(event) => { setPath(event.target.value); setPreview(null); setDone(false); setError(''); }} /></label>
    {accountAvailable && <label className="account-choice"><input type="checkbox" checked={sameAccount} disabled={busy} onChange={(event) => { setSameAccount(event.target.checked); setPreview(null); setDone(false); }} /> Ten eksport pochodzi z tego samego konta Google co wcześniejszy import.</label>}
    <button type="button" disabled={busy || !path.trim()} onClick={() => void submit('preview', { path: path.trim(), sameAccount })}>{busy ? 'Przetwarzanie…' : 'Przygotuj podgląd'}</button>
    {preview && <div><p>{preview.resuming ? 'Wznowienie zapisanego planu.' : 'Podgląd importu.'} Pliki: {preview.files}, wiersze rozpoznanych typów: {preview.rows}. {preview.accountLinked ? 'Import będzie przypisany do wcześniej potwierdzonego konta.' : 'Import pozostanie bez przypisanego konta.'} Pozostałe pliki Google Health zostaną zachowane jako oryginały. Identyczne pliki nie są zapisywane ponownie.</p><button type="button" disabled={busy} onClick={() => void submit('import', { token: preview.token })}>{busy ? 'Importowanie…' : preview.resuming ? 'Potwierdź wznowienie' : 'Potwierdź import'}</button></div>}
    {error && <p role="alert">{error}</p>}
    {done && <div><p role="status">Import zakończony. Wartości dzienne nie zostały jeszcze wyliczone.</p><button type="button" onClick={onComplete}>Pokaż dane</button></div>}
    {accountAvailable && unassignedImports > 0 && <div><p>Zakończone importy bez przypisanego konta: {unassignedImports}.</p><button type="button" disabled={busy} onClick={() => void assignAccount(false)}>Przygotuj przypisanie konta</button>
      {accountPreview && <div><p>Potwierdź, że wszystkie importy objęte podglądem ({accountPreview.count}) pochodzą z tego samego konta Google co wcześniejsze importy.</p><button type="button" disabled={busy} onClick={() => void assignAccount(true)}>Potwierdź przypisanie</button></div>}</div>}
    {accountDone && <p role="status">Przypisanie zapisane.</p>}
  </section>;
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
  const [sourceDate, setSourceDate] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    const query = new URLSearchParams({ kind, after: String(cursor) });
    if (sourceDate) query.set('date', sourceDate);
    fetch(`/api/source-records?${query}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Źródło'); return response.json(); })
      .then((data: unknown) => setPage(sourcePageSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, cursor, sourceDate, attempt]);
  const unit = kinds.find((item) => item.value === kind)?.unit;
  return <section><h2>Oryginały z Takeout</h2>
    <p>Surowe wiersze eksportu. Nie są jeszcze uzgodnione, odfiltrowane ani przeliczone na wyniki dnia; mogą zawierać kopie. Pozostałe pliki Google Health zachowano jako oryginały, ale ich zawartość nie ma jeszcze podglądu.</p>
    <label>Rodzaj danych <select value={kind} onChange={(event) => { setKind(event.target.value as SourceKind); setCursor(0); setHistory([]); setPage(null); }}>
      {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <label className="date-filter">Data w eksporcie <input type="date" value={sourceDate} onChange={(event) => { setSourceDate(event.target.value); setCursor(0); setHistory([]); setPage(null); }} /></label>
    <p>Filtr porównuje datę zapisaną w czasie źródłowym, bez przeliczania strefy dnia aplikacji.</p>
    {error ? <div role="alert"><p>Nie udało się otworzyć bazy Takeout. Jeśli dane nie były jeszcze importowane, wybierz „Import Takeout”. W przeciwnym razie uruchom aplikację poza środowiskiem izolowanym i spróbuj ponownie.</p><button type="button" onClick={() => setAttempt(attempt + 1)}>Spróbuj ponownie</button></div> : loading || !page ? <p>Ładowanie…</p> : page.rows.length === 0 ? <p>{sourceDate ? 'Brak wierszy dla wybranej daty.' : 'Brak wierszy tego typu w imporcie.'}</p> : <>
      <div className="table-wrap"><table><thead><tr><th>Czas źródła</th><th>Oryginał ({unit})</th><th>Po przeliczeniu</th><th>Źródło według eksportu</th></tr></thead>
        <tbody>{page.rows.map((row, index) => <tr key={`${cursor}-${index}`}><td>{row.timestamp || '—'}</td><td>{row.value || '—'}</td><td>{row.converted.status === 'parsed' ? `${row.converted.value.replace('.', ',')} ${row.converted.unit}` : row.converted.status === 'unsupported' ? 'Niepotwierdzona jednostka' : 'Nie można przeliczyć wartości'}</td><td>{row.source || '—'}</td></tr>)}</tbody></table></div>
      {history.length > 0 && <button type="button" onClick={() => { setCursor(history.at(-1)!); setHistory(history.slice(0, -1)); }}>Poprzednie</button>}
      {page.next !== null && <button type="button" onClick={() => { setHistory([...history, cursor]); setCursor(page.next!); }}>Następne 100</button>}
    </>}
  </section>;
}

createRoot(document.getElementById('root')!).render(<App />);
