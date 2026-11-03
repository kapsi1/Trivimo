import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { daysSchema, type Day } from '../../../packages/contracts/day.ts';
import { bodyReviewSchema, sourcePageSchema, type SourceKind, type SourcePage } from '../../../packages/contracts/source-records.ts';
import { dayResponseSchema, daySnapshotSchema, userNoteSchema } from '../../../packages/contracts/day-snapshot.ts';
import { z } from 'zod';
import { compareDailyRows } from './sort-days.ts';
import './style.css';

function App() {
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'demo' | 'source' | 'import' | 'overview' | 'table'>('source');
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
    <nav aria-label="Widok"><button type="button" disabled={overviewBusy} aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => changeTab('overview')}>Przegląd</button><button type="button" disabled={overviewBusy} aria-current={tab === 'table' ? 'page' : undefined} onClick={() => changeTab('table')}>Tabela dni</button><button type="button" disabled={overviewBusy} aria-current={tab === 'source' ? 'page' : undefined} onClick={() => changeTab('source')}>Dane Takeout</button><button type="button" disabled={overviewBusy} aria-current={tab === 'import' ? 'page' : undefined} onClick={() => changeTab('import')}>Import Takeout</button><button type="button" disabled={overviewBusy} aria-current={tab === 'demo' ? 'page' : undefined} onClick={() => changeTab('demo')}>Przykład</button></nav>
    {tab === 'table' && days && <DailyTable onViewSources={() => changeTab('source')} />}
    {tab === 'source' && days && <><GoogleConnection /><SourceRecords /></>}
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

const googleStatusSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }),
  z.object({ configured: z.literal(true), connected: z.boolean(), grantedScopes: z.array(z.string()), expiresAt: z.string().nullable() }),
]);
function GoogleConnection() {
  const [status, setStatus] = useState<z.infer<typeof googleStatusSchema> | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const controller = new AbortController(); fetch('/api/google/status', { signal: controller.signal })
    .then((response) => { if (!response.ok) throw new Error('Status'); return response.json(); })
    .then((data: unknown) => setStatus(googleStatusSchema.parse(data)))
    .catch(() => { if (!controller.signal.aborted) setError(true); }); return () => controller.abort(); }, []);
  async function connect() {
    setBusy(true); setError(false);
    try {
      const response = await fetch('/api/google/start', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: '{}' });
      if (!response.ok) throw new Error('OAuth');
      const data = z.object({ url: z.url() }).parse(await response.json());
      const url = new URL(data.url);
      if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('OAuth');
      window.location.assign(url.href);
    } catch { setError(true); setBusy(false); }
  }
  return <section><h2>Google Health</h2>
    {error && <p role="alert">Nie udało się rozpocząć autoryzacji lub odczytać jej stanu.</p>}
    {!status ? <p>Sprawdzanie konfiguracji…</p> : !status.configured ? <p>Klient OAuth nie jest skonfigurowany. Instrukcja znajduje się w dokumentacji środowiska.</p> : <>
      <p>{status.connected ? 'Konto jest autoryzowane.' : 'Konto nie jest autoryzowane.'} Token odświeżania jest zapisany na dysku, zaszyfrowany kontem Windows; przeglądarka go nie widzi. Dostępny jest próbny odczyt wagi i tkanki tłuszczowej; wyniki nie są jeszcze kwalifikowane.</p>
      {status.connected && <p>Przyznane zakresy odczytu: {status.grantedScopes.length} z 2.</p>}
      <p>Aplikacja poprosi o odczyt aktywności i pomiarów zdrowotnych, aby w przyszłości pobierać sześć metryk M1. Zakresy nie obejmują zapisu do Google.</p>
      <button type="button" disabled={busy} onClick={() => void connect()}>{busy ? 'Przekierowanie…' : 'Autoryzuj konto Google'}</button>
      {status.connected && <GoogleSync />}
      {status.connected && <GoogleReadJobs />}
    </>}
  </section>;
}

const googleJobSchema = z.object({ id: z.uuid(), kind: z.enum(['weight', 'body-fat', 'steps', 'distance', 'total-calories', 'active-energy-burned', 'heart-rate-10m', 'active-energy-10m', 'total-calories-10m', 'steps-10m', 'distance-10m']), start: z.string().max(40), end: z.string().max(40), state: z.enum(['running', 'complete']), createdAt: z.iso.datetime(), pages: z.number().int().nonnegative() });
function googleJobsError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'migration_required') return 'Wersja magazynu wymaga migracji z kopią zapasową.';
  if (code === 'store_unavailable') return 'Nie można otworzyć magazynu. Sprawdź lokalizację bazy i dostęp do pliku.';
  if (code === 'service_unavailable') return 'Usługa odczytu Google jest niedostępna. Sprawdź konfigurację serwera i lokalizację bazy.';
  if (code === 'invalid_jobs_response') return 'Serwer zwrócił nieoczekiwany format listy zadań. Sprawdź wersje serwera i interfejsu.';
  return 'Nie udało się pobrać listy zadań Google. Sprawdź połączenie z serwerem i spróbuj ponownie.';
}
const syncStatusSchema = z.object({
  automatic: z.number().nullable(), running: z.boolean(), unfinishedJobs: z.number(), pausedUntil: z.string().nullable(),
  last: z.object({ at: z.string(), result: z.enum(['ok', 'authorization_required', 'scope_missing', 'migration_required', 'error']), code: z.string().optional(), reads: z.number(), retryAt: z.string().optional() }).nullable(),
  kinds: z.array(z.object({ kind: z.string(), lastReadAt: z.string().nullable(), coveredThrough: z.string().nullable() })),
});
const syncLabels: Record<string, string> = { steps: 'Kroki', distance: 'Dystans', 'total-calories': 'Kalorie total', 'active-energy-burned': 'Kalorie aktywne', 'heart-rate-10m': 'Tętno (okna)', 'active-energy-10m': 'Kalorie aktywne (okna)', 'total-calories-10m': 'Kalorie total (okna)', 'steps-10m': 'Kroki (okna)', 'distance-10m': 'Dystans (okna)' };
function GoogleSync() {
  const [status, setStatus] = useState<z.infer<typeof syncStatusSchema> | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  async function load() {
    const response = await fetch('/api/google/sync-status');
    if (!response.ok) throw new Error('Status');
    setStatus(syncStatusSchema.parse(await response.json()));
  }
  useEffect(() => { void load().catch(() => setError(true)); }, []);
  async function refresh() {
    setBusy(true); setError(false);
    try {
      const response = await fetch('/api/google/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: '{}' });
      if (!response.ok) throw new Error('Odświeżenie');
      await load();
    } catch { setError(true); } finally { setBusy(false); }
  }
  const outcome = status?.last;
  const text = !outcome ? 'Jeszcze nie uruchomiono w tej sesji serwera.' : outcome.result === 'ok' ? `Ostatnie odświeżenie: ${outcome.at} (${outcome.reads} odczytów).` : outcome.result === 'authorization_required' || outcome.result === 'scope_missing' ? 'Odświeżenie wymaga ponownej autoryzacji z wymaganymi zakresami.' : outcome.result === 'migration_required' ? 'Magazyn wymaga migracji z kopią zapasową.' : outcome.code === 'rate_limited' || /http_429$/.test(outcome.code ?? '') ? `Google ogranicza liczbę zapytań (429) mimo ponowień z odstępem; zapisane dane pozostały bez zmian, a odczyty są wstrzymane do ${outcome.retryAt ?? '—'}.` : `Ostatnie odświeżenie nie powiodło się${outcome.code ? ` (kod: ${outcome.code})` : ''}; zapisane dane pozostały bez zmian, kolejna próba nastąpi przy następnym uruchomieniu.`;
  return <section><h3>Odświeżanie bieżących dni</h3>
    <p>Odczyt obejmuje dzisiejszą dobę oraz ostatnie trzy zakończone doby (po przerwie także dni od ostatniego odczytu, do 13). Każdy odczyt zachowuje oryginał. {status?.automatic ? `Automatycznie co ${status.automatic} min, gdy serwer działa; przerwa w działaniu serwera nie jest nadrabiana wstecz poza tym zakresem.` : 'Automatyczne odświeżanie jest wyłączone (zmienna TRIVIMO_GOOGLE_SYNC_MINUTES, od 15 do 1440 min).'}</p>
    {error && <p role="alert">Nie udało się odczytać stanu lub uruchomić odświeżenia.</p>}
    {status && <p role="status">{text}{status.unfinishedJobs > 0 ? ` Niedokończone zadania: ${status.unfinishedJobs}.` : ''}</p>}
    <button type="button" disabled={busy || status?.running} onClick={() => void refresh()}>{busy ? 'Odświeżanie…' : 'Odśwież teraz'}</button>
    {status && <ul>{status.kinds.map((item) => <li key={item.kind}>{syncLabels[item.kind] ?? item.kind}: {item.lastReadAt ? `odczytano ${item.lastReadAt}, pokryte do ${item.coveredThrough ?? '—'}` : 'brak zapisanego odczytu'}</li>)}</ul>}
  </section>;
}

function GoogleReadJobs() {
  const [jobs, setJobs] = useState<z.infer<typeof googleJobSchema>[] | null>(null);
  const [kind, setKind] = useState<'weight' | 'body-fat' | 'steps' | 'distance' | 'total-calories' | 'active-energy-burned' | 'heart-rate-10m' | 'active-energy-10m' | 'total-calories-10m' | 'steps-10m' | 'distance-10m'>('weight');
  const [date, setDate] = useState(() => { const d = new Date(`${warsawToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); });
  const [lastDate, setLastDate] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const daily = kind === 'steps' || kind === 'distance' || kind === 'total-calories' || kind === 'active-energy-burned';
  const nextCivilDay = (value: string) => new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const rangeInvalid = daily && !!lastDate && (lastDate < date || (Date.parse(lastDate) - Date.parse(date)) / 86400000 + 1 > (kind === 'total-calories' ? 14 : 90));
  async function refresh() {
    const response = await fetch('/api/google/jobs');
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof data?.error === 'string' ? data.error : 'request_failed');
    }
    const parsed = z.array(googleJobSchema).safeParse(await response.json());
    if (!parsed.success) throw new Error('invalid_jobs_response');
    setJobs(parsed.data);
  }
  function retry() { setMessage(''); void refresh().catch((error: unknown) => setMessage(googleJobsError(error))); }
  useEffect(() => { retry(); }, []);
  async function run(path: string, body: object) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: JSON.stringify(body) });
      if (!response.ok) { const data = await response.json() as { error?: string; detail?: string }; throw Object.assign(new Error(data.error), { detail: data.detail }); }
      setMessage(path.endsWith('/next') ? 'Strona została zapisana; nie przeliczono wyników dnia.' : 'Zadanie zapisano. Możesz pobrać pierwszą stronę.');
      try { await refresh(); } catch { setMessage('Operacja zakończona, ale nie udało się odświeżyć listy zadań. Odśwież listę przed kolejną operacją.'); setJobs(null); }
    } catch (error) { const code = error instanceof Error ? error.message : ''; setMessage(code === 'account_changed' ? 'Zadanie należy do innego konta Google.' : code === 'authorization_required' || code === 'scope_missing' ? 'Ponów autoryzację z wymaganym zakresem.' : `Nie udało się wykonać operacji. Zapisane strony i postęp pozostają bez zmian.${error instanceof Error && 'detail' in error && typeof error.detail === 'string' ? ` Kod: ${error.detail}.` : ''}`); }
    finally { setBusy(false); }
  }
  return <section><h3>Odczyt próbny</h3><p>Jedno zadanie obejmuje wybrany dzień i rodzaj pomiaru; masa i tłuszcz używają dnia warszawskiego, kroki, dystans i kalorie doby cywilnej producenta. Przygotowanie zapisuje zadanie; pobranie strony odczytuje jedną porcję danych Google. Oryginały nie są jeszcze kwalifikowane ani łączone z Takeout.</p>
    <label>Rodzaj <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as typeof kind)}><optgroup label="Pomiary (doba warszawska)"><option value="weight">Masa ciała</option><option value="body-fat">Tkanka tłuszczowa</option></optgroup><optgroup label="Sumy dobowe (doba producenta)"><option value="steps">Kroki — suma doby</option><option value="distance">Dystans — suma doby</option><option value="total-calories">Kalorie total — suma doby (zawiera BMR)</option><option value="active-energy-burned">Kalorie aktywne — suma doby</option></optgroup><optgroup label="Okna 10 min (doba warszawska)"><option value="heart-rate-10m">Tętno — okna 10 min</option><option value="active-energy-10m">Kalorie aktywne — okna 10 min</option><option value="total-calories-10m">Kalorie total — okna 10 min</option><option value="steps-10m">Kroki — okna 10 min</option><option value="distance-10m">Dystans — okna 10 min</option></optgroup></select></label>{' '}
    <label>Data w Warszawie <input type="date" min="2026-01-01" max="9998-12-31" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /></label>{' '}
    {daily && <><label>Do dnia (włącznie, opcjonalnie; do {kind === 'total-calories' ? 14 : 90} dób) <input type="date" min={date} max="9998-12-31" value={lastDate} disabled={busy} onChange={(event) => setLastDate(event.target.value)} /></label>{' '}</>}
    <button type="button" disabled={busy || !date || !jobs || rangeInvalid} onClick={() => void run('/api/google/jobs', daily && lastDate ? { kind, start: date, end: nextCivilDay(lastDate) } : { kind, date })}>Przygotuj zadanie</button>
    {message && <p role="status">{message}</p>}
    {!jobs && <button type="button" disabled={busy} onClick={retry}>Ponów odczyt listy zadań</button>}
    {jobs && jobs.length > 0 && <div className="table-wrap"><table><thead><tr><th>Typ</th><th>Zakres UTC / doby</th><th>Stan</th><th>Strony</th><th>Akcja</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>{({ weight: 'Masa ciała', 'body-fat': 'Tkanka tłuszczowa', steps: 'Kroki — suma doby', distance: 'Dystans — suma doby', 'total-calories': 'Kalorie total — suma doby', 'active-energy-burned': 'Kalorie aktywne — suma doby', 'heart-rate-10m': 'Tętno — okna 10 min', 'active-energy-10m': 'Kalorie aktywne — okna 10 min', 'total-calories-10m': 'Kalorie total — okna 10 min', 'steps-10m': 'Kroki — okna 10 min', 'distance-10m': 'Dystans — okna 10 min' })[job.kind]}</td><td>{job.start} – {job.end}{job.kind === 'steps' || job.kind === 'distance' || job.kind === 'total-calories' || job.kind === 'active-energy-burned' ? ' (doba producenta)' : ''}</td><td>{job.state === 'complete' ? 'Odczyt zakończony' : 'Do kontynuacji'}</td><td>{job.pages}</td><td>{job.state === 'running' && <button type="button" disabled={busy} onClick={() => void run('/api/google/jobs/next', { id: job.id })}>Pobierz stronę</button>}</td></tr>)}</tbody></table></div>}
  </section>;
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

const rangeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_ready') }),
  z.object({ state: z.literal('ready'), days: z.array(z.object({ date: z.iso.date(), snapshot: daySnapshotSchema.nullable(), userNote: userNoteSchema.nullable() })) }),
]);

const bandRangeSchema = z.array(z.object({ date: z.iso.date(), totalWindows: z.number().int().positive(), heartRate: z.object({ windows: z.number().int().nonnegative() }).nullable() }));
function DailyTable({ onViewSources }: { onViewSources: () => void }) {
  const [to, setTo] = useState(warsawToday);
  const [from, setFrom] = useState(() => { const date = new Date(`${warsawToday()}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 29); return date.toISOString().slice(0, 10); });
  const [problems, setProblems] = useState(false);
  const [descending, setDescending] = useState(true);
  const [sortBy, setSortBy] = useState<'date' | (typeof dailyMetrics)[number][0]>('date');
  const [selected, setSelected] = useState<{ date: string; key: (typeof dailyMetrics)[number][0] } | null>(null);
  const [visibleMetrics, setVisibleMetrics] = useState<Set<(typeof dailyMetrics)[number][0]>>(() => new Set(dailyMetrics.map(([key]) => key)));
  const [result, setResult] = useState<z.infer<typeof rangeSchema> | null>(null);
  const [error, setError] = useState(false);
  const [band, setBand] = useState<Map<string, { windows: number; total: number }> | null>(null);
  const valid = !!from && !!to && from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 365;
  useEffect(() => {
    setResult(null); setError(false);
    if (!valid) return;
    const controller = new AbortController();
    fetch(`/api/day-range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Zakres'); return response.json(); })
      .then((data: unknown) => setResult(rangeSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [from, to, valid]);
  useEffect(() => {
    setBand(null);
    if (!valid) return;
    const controller = new AbortController();
    fetch(`/api/google/band-share-range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Opaska'); return response.json(); })
      .then((data: unknown) => setBand(new Map(bandRangeSchema.parse(data).flatMap((item) => item.heartRate ? [[item.date, { windows: item.heartRate.windows, total: item.totalWindows }] as const] : []))))
      .catch(() => { /* the column then shows "—": the band share is an optional addition to the table */ });
    return () => controller.abort();
  }, [from, to, valid]);
  const today = warsawToday();
  function sortOn(key: typeof sortBy) {
    if (key === sortBy) setDescending((value) => !value);
    else { setSortBy(key); setDescending(key === 'date'); }
  }
  return <section><h2>Tabela dni</h2>
    <label>Od <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>{' '}
    <label>Do <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>{' '}
    <label><input type="checkbox" checked={problems} onChange={(event) => setProblems(event.target.checked)} /> Tylko dni z uwagami</label>
    <details className="column-picker"><summary>Wybierz metryki ({visibleMetrics.size}/{dailyMetrics.length})</summary>
      <fieldset><legend>Widoczne metryki</legend>{dailyMetrics.map(([key, label]) => <label key={key}><input type="checkbox" checked={visibleMetrics.has(key)} onChange={(event) => { const checked = event.target.checked; if (!checked && sortBy === key) { setSortBy('date'); setDescending(true); } setVisibleMetrics((current) => { const next = new Set(current); if (checked) next.add(key); else next.delete(key); return next; }); }} /> {label}</label>)}</fieldset>
    </details>
    <p>Dzień aplikacji: Europe/Warsaw. Maksymalnie 366 dni; brak wyliczonego wyniku pozostaje pusty.</p>
    {!valid ? <p role="alert">Wybierz poprawny zakres do 366 dni.</p> : error ? <p role="alert">Nie udało się odczytać tabeli.</p> : !result ? <p>Ładowanie…</p> : result.state === 'not_ready' ? <p>Wyniki dzienne nie są jeszcze przygotowane.</p> : <>
      {!result.days.some((day) => day.snapshot !== null) && <div role="status" className="empty-results"><p>W tym zakresie nie ma jeszcze obliczonych wyników dziennych. Pobrane i zaimportowane dane źródłowe nie są jeszcze automatycznie przeliczane na tę tabelę.</p><button type="button" onClick={onViewSources}>Zobacz dane źródłowe</button></div>}
      <div className="table-wrap"><table><thead><tr><th scope="col" aria-sort={sortBy === 'date' ? descending ? 'descending' : 'ascending' : undefined}><button type="button" onClick={() => sortOn('date')}>Data {sortBy === 'date' ? descending ? '↓' : '↑' : ''}</button></th>{dailyMetrics.filter(([key]) => visibleMetrics.has(key)).map(([key, label, unit]) => <th key={key} scope="col" aria-sort={sortBy === key ? descending ? 'descending' : 'ascending' : undefined}><button type="button" onClick={() => sortOn(key)}>{label} ({unit}) {sortBy === key ? descending ? '↓' : '↑' : ''}</button></th>)}<th scope="col" title="Udział doby warszawskiej, w której urządzenie mierzyło tętno (okna 10-minutowe). Dowód pomiaru, nie noszenia przez całe okno; — oznacza brak zapisanego odczytu tętna dla całej doby.">Udział opaski</th><th>Uwagi</th><th>Moja notatka</th></tr></thead><tbody>
        {result.days.filter((day) => !problems || (day.snapshot?.notes.length ?? 0) > 0).sort((a, b) => compareDailyRows(a, b, sortBy, descending)).map((day) => <tr key={day.date}><td>{day.date}{day.date === today && <span title="Doba jeszcze trwa: wartości mogą się zmienić po kolejnym odczycie lub synchronizacji urządzenia."> (w toku)</span>}</td>{dailyMetrics.filter(([key]) => visibleMetrics.has(key)).map(([key, label, , decimals]) => { const metric = day.snapshot?.metrics[key]; return <td key={key}><button type="button" className="metric-cell" aria-label={`${label}, ${day.date}: ${metric ? quality[metric.status] : 'Brak obliczonego wyniku'}`} onClick={() => setSelected({ date: day.date, key })}>{metric?.value == null ? '—' : formatRational(metric.value, decimals)}</button></td>; })}<td>{(() => { const share = band?.get(day.date); return share ? <span title={`${share.windows} z ${share.total} okien 10-minutowych z tętnem`}>{(share.windows / share.total * 100).toLocaleString('pl-PL', { maximumFractionDigits: 0 })}%</span> : '—'; })()}</td><td>{day.snapshot?.notes.join('; ') || '—'}</td><td>{day.userNote?.content || '—'}</td></tr>)}
      </tbody></table>{problems && !result.days.some((day) => (day.snapshot?.notes.length ?? 0) > 0) && <p>Brak dni z uwagami w wybranym zakresie.</p>}</div>
      {selected && (() => { const day = result.days.find((item) => item.date === selected.date); const definition = dailyMetrics.find(([key]) => key === selected.key); const metric = day?.snapshot?.metrics[selected.key]; if (!day || !definition) return null; return <section aria-label="Szczegóły metryki"><h3>{definition[1]} — {day.date}</h3><p>Stan: {metric ? quality[metric.status] : 'Brak obliczonego wyniku'}.</p><p>Wartość: {metric?.value == null ? 'brak' : `${formatRational(metric.value, definition[3])} ${definition[2]}`}.</p><p>Rewizja wyniku: {day.snapshot?.revision ?? 'brak'}. Szczegóły źródła i decyzji kwalifikacyjnych nie są jeszcze zapisane w tej projekcji.</p><button type="button" onClick={() => setSelected(null)}>Zamknij szczegóły</button></section>; })()}
    </>}
  </section>;
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
      <BodyComparison key={`body-${date}`} date={date} />
      {response.notesAvailable && <UserNoteEditor key={`note-${date}`} date={date} initial={response.userNote} onDirty={onDirty} onBusy={onBusy} />}
    </>}
  </section>;
}

function BodyComparison({ date }: { date: string }) {
  const [kind, setKind] = useState<'weight' | 'body_fat'>('weight');
  const [visible, setVisible] = useState(false);
  return <div><h3>Porównanie pomiarów źródłowych</h3>
    <p>Kandydaci są przypisani do dnia warszawskiego. Powtórzone odczyty i kopie między źródłami nie zostały uzgodnione, a kompletność jest nieznana. Identyfikator źródłowy ani zgodność czasu lub wartości nie potwierdzają tożsamości pomiaru między źródłami.</p>
    {!visible ? <button type="button" onClick={() => setVisible(true)}>Pokaż pomiary</button> : <>
      <label>Rodzaj <select value={kind} onChange={(event) => setKind(event.target.value as 'weight' | 'body_fat')}><option value="weight">Masa ciała</option><option value="body_fat">Tkanka tłuszczowa</option></select></label>
      <BodyCandidates key={`takeout-${kind}`} date={date} kind={kind} source="takeout" />
      <BodyCandidates key={`google-${kind}`} date={date} kind={kind} source="google" />
    </>}
    <h3>Agregaty dzienne Google</h3>
    <GoogleDailyCandidates key="daily-steps" date={date} kind="steps" />
    <GoogleDailyCandidates key="daily-distance" date={date} kind="distance" />
    <GoogleDailyCandidates key="daily-total" date={date} kind="total-calories" />
    <GoogleDailyCandidates key="daily-active" date={date} kind="active-energy-burned" />
    <BandShare key="band-share" date={date} />
    <DaySeries key="day-series" date={date} />
  </div>;
}

const dailyReviewSchema = z.object({
  rows: z.array(z.object({ originalValue: z.string(), unit: z.enum(['steps', 'mm', 'kcal']), converted: z.object({ value: z.string(), unit: z.enum(['szt.', 'km', 'kcal']) }).nullable(), receivedAt: z.string() })),
  truncated: z.boolean(), coverage: z.literal('unknown'), multipleAccounts: z.boolean(),
  jobs: z.array(z.object({ start: z.string(), end: z.string(), state: z.enum(['running', 'complete']) })),
});
const bandShareSchema = z.object({
  totalWindows: z.number().int().positive(),
  heartRate: z.object({ windows: z.number().int().nonnegative() }).nullable(),
  activeEnergy: z.object({ bandKcal: z.string(), bandWindows: z.number().int(), otherKcal: z.string(), otherWindows: z.number().int() }).nullable(),
  activeEnergyRead: z.boolean(),
});
const seriesSchema = z.object({
  unit: z.enum(['steps', 'mm', 'kcal']), windowsPerDay: z.number(), windows: z.number(),
  hours: z.array(z.object({ start: z.iso.datetime(), value: z.string().nullable() })), total: z.string(),
}).nullable();
const seriesMetricLabels = { steps: 'Kroki', distance: 'Dystans', 'total-calories': 'Kalorie total (zawiera BMR)', 'active-energy-burned': 'Kalorie aktywne' } as const;
function DaySeries({ date }: { date: string }) {
  const [metric, setMetric] = useState<keyof typeof seriesMetricLabels>('total-calories');
  const [result, setResult] = useState<z.infer<typeof seriesSchema> | undefined>(undefined);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined); setError(false);
    fetch(`/api/google/day-series?metric=${metric}&date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Seria'); return response.json(); })
      .then((data: unknown) => setResult(seriesSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [date, metric]);
  const hourOf = (iso: string) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const shown = (value: string) => result?.unit === 'mm' ? (Number(value) / 1000000).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) : Number(value).toLocaleString('pl-PL', { maximumFractionDigits: result?.unit === 'kcal' ? 1 : 0 });
  const unitLabel = result?.unit === 'mm' ? 'km' : result?.unit === 'kcal' ? 'kcal' : 'kroków';
  const max = Math.max(0, ...(result?.hours.map((hour) => Number(hour.value ?? 0)) ?? []));
  return <div><h4>Przebieg doby (godziny, dzień warszawski)</h4>
    {date === warsawToday() && <p role="status">Doba jeszcze trwa: wykres jest częściowy.</p>}
    <label>Metryka <select value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}>{(Object.entries(seriesMetricLabels) as [keyof typeof seriesMetricLabels, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {error ? <p role="alert">Nie udało się odczytać serii.</p> : result === undefined ? <p>Ładowanie…</p> : result === null ? <p>Brak zapisanego odczytu okien 10-minutowych dla całej doby (rodzaj „{({ steps: 'Kroki', distance: 'Dystans', 'total-calories': 'Kalorie total', 'active-energy-burned': 'Kalorie aktywne' })[metric]} — okna 10 min”).</p> : <>
      <div className="chart" aria-label={`${seriesMetricLabels[metric]} według godziny`}>{result.hours.map((hour) => <div className="bar-row" key={hour.start}><span>{hourOf(hour.start)}</span><div className="track">{hour.value !== null && <div className="bar" style={{ width: `${max > 0 ? Number(hour.value) / max * 100 : 0}%` }} />}</div><span>{hour.value === null ? 'brak' : shown(hour.value)}</span></div>)}</div>
      <p>Suma godzin: {shown(result.total)} {unitLabel} ({result.windows} z {result.windowsPerDay} okien z wartością). Godzina bez okien to brak odczytu, nie zero.</p>
    </>}
  </div>;
}

function BandShare({ date }: { date: string }) {
  const [result, setResult] = useState<z.infer<typeof bandShareSchema> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(false);
    fetch(`/api/google/band-share?date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Dane'); return response.json(); })
      .then((data: unknown) => setResult(bandShareSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [date]);
  const percent = (part: number, whole: number) => `${(part / whole * 100).toLocaleString('pl-PL', { maximumFractionDigits: 0 })}%`;
  return <div><h4>Udział opaski w dobie (dzień warszawski, okna 10-minutowe)</h4>
    {date === warsawToday() && <p role="status">Doba jeszcze trwa: wartości są częściowe i rosną z kolejnymi odczytami oraz synchronizacją urządzenia; nie traktuj ich jako pełnej doby.</p>}
    {error ? <p role="alert">Nie udało się odczytać udziału opaski.</p> : !result ? <p>Ładowanie…</p> : !result.heartRate ? <p>Brak zapisanego odczytu tętna dla całej doby (rodzaj „Tętno — okna 10 min"). Bez niego nie wiadomo, kiedy opaska mierzyła.</p> : <>
      <p>Tętno z urządzenia w {result.heartRate.windows} z {result.totalWindows} okien ({percent(result.heartRate.windows, result.totalWindows)} doby). To dowód pomiaru, nie dowód noszenia przez całe okno.</p>
      {result.activeEnergy ? <p>Aktywne kalorie: {result.activeEnergy.bandKcal.replace('.', ',')} kcal w oknach z tętnem opaski ({result.activeEnergy.bandWindows} okien) i {result.activeEnergy.otherKcal.replace('.', ',')} kcal w oknach bez niego ({result.activeEnergy.otherWindows} okien, szacunek telefonu lub brak pomiaru tętna). Opaska liczy wysiłek z tętna, telefon z kroków, więc kcal z obu źródeł nie są wprost porównywalne.</p>
        : <p>{result.activeEnergyRead ? '' : 'Brak zapisanego odczytu aktywnych kalorii w oknach 10-minutowych dla całej doby (rodzaj „Kalorie aktywne — okna 10 min").'}</p>}
      <p>Wartość całkowita kalorii pozostaje jedną wartością producenta; udział opaski dotyczy tylko podziału części aktywnej.</p>
    </>}
  </div>;
}

function GoogleDailyCandidates({ date, kind }: { date: string; kind: 'steps' | 'distance' | 'total-calories' | 'active-energy-burned' }) {
  const [result, setResult] = useState<z.infer<typeof dailyReviewSchema> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(false);
    fetch(`/api/google/daily-candidates?kind=${kind}&date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Dane'); return response.json(); })
      .then((data: unknown) => setResult(dailyReviewSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [date, kind]);
  return <div><h4>Google Health API — {({ steps: 'kroki', distance: 'dystans', 'total-calories': 'kalorie total (zawiera BMR)', 'active-energy-burned': 'kalorie aktywne' })[kind]} (doba producenta)</h4>
    {date === warsawToday() && <p role="status">Doba jeszcze trwa: wartości są częściowe i rosną z kolejnymi odczytami oraz synchronizacją urządzenia; nie traktuj ich jako pełnej doby.</p>}
    {error ? <p role="alert">Nie udało się odczytać zapisanych agregatów.</p> : !result ? <p>Ładowanie…</p> : <>
      {result.multipleAccounts && <p>Zapisane zadania obejmują więcej niż jedno konto Google. Konta nie zostały połączone.</p>}
      {result.rows.length === 0 ? <p>{result.jobs.length ? 'Zapisane zadania nie zawierają wartości dla tej doby; brak wartości nie oznacza zera.' : 'Brak zapisanego zadania dla tej doby.'} Kompletność źródła jest nieznana.</p> : <div className="table-wrap"><table><thead><tr><th>Oryginał ({({ steps: 'kroki', distance: 'mm', 'total-calories': 'kcal', 'active-energy-burned': 'kcal' })[kind]})</th><th>Po przeliczeniu</th><th>Zapisano</th><th>Odczyt</th></tr></thead><tbody>
        {result.rows.map((row, index) => <tr key={index}><td>{row.originalValue}</td><td>{row.converted ? `${row.converted.value.replace('.', ',')} ${row.converted.unit}` : 'Nie można przeliczyć'}</td><td>{row.receivedAt}</td><td>{index === 0 ? 'Najnowszy' : 'Wcześniejszy'}</td></tr>)}
      </tbody></table></div>}
      {result.rows.length > 1 && <p>Dla tej doby zapisano kilka odczytów (każde pobranie zadania zachowuje swój oryginał, także gdy doba jeszcze trwa i wartość rośnie); nie zostały uzgodnione ani zsumowane, a najnowszy jest pierwszy.</p>}
      {result.truncated && <p>Wyniki są ograniczone.</p>}
      <p>Wartość jest sumą doby cywilnej producenta, a nie dnia warszawskiego; nie jest kwalifikowana ani porównywana z Takeout.</p>
    </>}
  </div>;
}

function BodyCandidates({ date, kind, source }: { date: string; kind: 'weight' | 'body_fat'; source: 'takeout' | 'google' }) {
  const [result, setResult] = useState<z.infer<typeof bodyReviewSchema> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(false);
    fetch(`/api/${source === 'google' ? 'google/body-candidates' : 'body-candidates'}?kind=${kind}&date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Dane'); return response.json(); })
      .then((data: unknown) => setResult(bodyReviewSchema.parse(data)))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [date, kind, source]);
  return <div><h4>{source === 'google' ? 'Google Health API' : 'Takeout'}</h4>
      {error ? <p role="alert">Nie udało się odczytać pomiarów źródłowych.</p> : !result ? <p>Ładowanie…</p> : <>
        {result.jobs && <div><p>Zapisane zadania odczytu nakładające się na dzień Warszawy (granice UTC, koniec wyłączony):</p>
          {result.jobs.length ? <ul>{result.jobs.map((job, index) => <li key={index}>{job.start} – {job.end}: {job.state === 'complete' ? 'odczyt zakończony' : 'odczyt niezakończony'}</li>)}</ul> : <p>Brak zapisanego zadania dla tego zakresu.</p>}
          {result.jobsTruncated && <p>Lista zadań jest ograniczona do 50.</p>}
          <p>Zakończenie odczytu nie potwierdza kompletności danych w źródle ani powiązania kont z importem.</p>
        </div>}
        {result.unassigned > 0 && <p>Niektórych rekordów źródłowych nie udało się przypisać do dnia lub odczytać.</p>}
        {result.multipleAccounts && <p>Zapisane zadania obejmują więcej niż jedno konto Google. Konta nie zostały połączone.</p>}
        {result.rows.length === 0 ? <p>Nie znaleziono pomiarów dla wybranej daty; kompletność źródła jest nieznana.</p> : <>
          <div className="table-wrap"><table><thead><tr><th>Czas źródła</th><th>Oryginał ({kind === 'weight' ? 'g' : '%'})</th><th>Po przeliczeniu</th><th>Źródło</th><th>Tożsamość</th></tr></thead><tbody>
            {result.rows.map((row, index) => <tr key={index}><td>{row.timestamp}</td><td>{row.originalValue || '—'}</td><td>{row.converted.status === 'parsed' ? `${row.converted.value.replace('.', ',')} ${row.converted.unit}` : 'Nie można przeliczyć'}</td><td>{row.origin || 'Nieznane'}</td><td>{row.identity === 'identified' ? 'Identyfikator źródłowy' : row.identity === 'candidate' ? 'Kandydat do ustalenia' : 'Nierozstrzygnięta'}</td></tr>)}
          </tbody></table></div>
        </>}
        {result.truncated && <p>Wyniki są ograniczone; pokazano {result.rows.length} z co najmniej {result.matched} dopasowanych wierszy.</p>}
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
