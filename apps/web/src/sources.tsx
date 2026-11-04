import { useEffect, useState } from 'react';
import { z } from 'zod';
import { sourcePageSchema, type SourceKind, type SourcePage } from '../../../packages/contracts/source-records.ts';
import { coverageSchema, post, useJson, type SyncStatus } from './api.ts';
import { addDays, diffDays, MON, mondayOf, warsawToday, whenOf } from './format.ts';

export type SourcesTab = 'polaczenia' | 'pokrycie' | 'importy' | 'diagnostyka';
const googleStatusSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }),
  z.object({ configured: z.literal(true), connected: z.boolean(), grantedScopes: z.array(z.string()), expiresAt: z.string().nullable() }),
]);

/** Text of the last refresh outcome; codes only, never response values or secrets. */
export function syncText(status: SyncStatus | undefined): string {
  const outcome = status?.last;
  if (!outcome) return 'Jeszcze nie uruchomiono w tej sesji serwera.';
  if (outcome.result === 'ok') return `Ostatnie odświeżenie: ${whenOf(outcome.at)} (${outcome.reads} odczytów).`;
  if (outcome.result === 'authorization_required' || outcome.result === 'scope_missing') return 'Odświeżenie wymaga ponownej autoryzacji z wymaganymi zakresami.';
  if (outcome.result === 'migration_required') return 'Magazyn wymaga migracji z kopią zapasową.';
  if (outcome.code === 'rate_limited' || /http_429$/.test(outcome.code ?? '')) return `Google ogranicza liczbę zapytań (429); zapisane dane pozostały bez zmian, odczyty wstrzymane do ${outcome.retryAt ? whenOf(outcome.retryAt) : '—'}.`;
  return `Ostatnie odświeżenie nie powiodło się${outcome.code ? ` (kod: ${outcome.code})` : ''}; zapisane dane pozostały bez zmian.`;
}

export function SourcesView({ tab, onTab, sync, onSyncChanged }: { tab: SourcesTab; onTab: (tab: SourcesTab) => void; sync: SyncStatus | undefined; onSyncChanged: () => void }) {
  const tabs: [SourcesTab, string][] = [['polaczenia', 'Połączenia'], ['pokrycie', 'Pokrycie historii'], ['importy', 'Importy plików'], ['diagnostyka', 'Diagnostyka']];
  const head = <div className="tabs" role="tablist" aria-label="Źródła danych">{tabs.map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={tab === key} onClick={() => onTab(key)}>{label}</button>)}</div>;
  if (tab === 'pokrycie') return <>{head}<Coverage /><section className="panel legacy"><GoogleBackfill /></section></>;
  if (tab === 'importy') return <>{head}<section className="panel legacy"><TakeoutImport onComplete={() => undefined} /></section><section className="panel legacy"><SourceRecords /></section></>;
  if (tab === 'diagnostyka') return <>{head}<SyncKinds sync={sync} /><section className="panel legacy"><GoogleReadJobs /></section></>;
  return <>{head}<Connections sync={sync} onSyncChanged={onSyncChanged} onImports={() => onTab('importy')} /></>;
}

function Connections({ sync, onSyncChanged, onImports }: { sync: SyncStatus | undefined; onSyncChanged: () => void; onImports: () => void }) {
  const status = useJson('/api/google/status', googleStatusSchema);
  const [busy, setBusy] = useState<'' | 'sync' | 'auth'>(''); const [error, setError] = useState('');
  async function connect() {
    setBusy('auth'); setError('');
    try {
      const response = await post('/api/google/start', {});
      if (!response.ok) throw new Error('OAuth');
      const url = new URL(z.object({ url: z.url() }).parse(await response.json()).url);
      if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('OAuth');
      window.location.assign(url.href);
    } catch { setError('Nie udało się rozpocząć autoryzacji.'); setBusy(''); }
  }
  async function refresh() {
    setBusy('sync'); setError('');
    try { const response = await post('/api/google/sync', {}); if (!response.ok) throw new Error('sync'); } catch { setError('Nie udało się uruchomić odświeżenia.'); } finally { setBusy(''); onSyncChanged(); }
  }
  const google = status.data;
  const ok = google?.configured && google.connected;
  const latest = sync?.kinds.map((kind) => kind.lastReadAt).filter((at): at is string => !!at).sort().at(-1);
  return <div className="cards">
    <section className="panel src"><header><h3>Google Health API</h3><span className="tag">główne źródło</span></header>
      {status.error ? <p role="alert">Nie udało się odczytać stanu połączenia.</p> : !google ? <p>Sprawdzanie konfiguracji…</p> : !google.configured ? <p className="sub">Klient OAuth nie jest skonfigurowany. Instrukcja jest w dokumentacji środowiska.</p> : <>
        <div className="state"><span className={`dot ${ok && sync?.last?.result !== 'error' ? '' : 'warn'}`} />{google.connected ? 'Połączono · tylko odczyt' : 'Konto nie jest autoryzowane'}</div>
        <dl className="kv"><dt>Zakresy</dt><dd>{google.grantedScopes.length} z 2 (aktywność, pomiary)</dd>
          <dt>Ostatni odczyt</dt><dd>{latest ? whenOf(latest) : 'brak zapisanego odczytu'}</dd>
          <dt>Stan</dt><dd role="status">{syncText(sync)}{sync && sync.unfinishedJobs > 0 ? ` Niedokończone zadania: ${sync.unfinishedJobs}.` : ''}</dd>
          <dt>Harmonogram</dt><dd>{sync?.automatic ? `co ${sync.automatic} min, gdy serwer działa` : 'tylko ręcznie (zmienna TRIVIMO_GOOGLE_SYNC_MINUTES)'}</dd>
          <dt>Odświeża</dt><dd>dziś i 3 ostatnie zakończone doby (po przerwie do 13)</dd>
          <dt>Token</dt><dd>na dysku, zaszyfrowany kontem Windows; przeglądarka go nie widzi</dd></dl>
        {error && <p role="alert">{error}</p>}
        <div className="actions">{google.connected && <button type="button" className="btn" disabled={!!busy || sync?.running} onClick={() => void refresh()}><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.3L3 9M3 4v5h5M4 13a8 8 0 0 0 14.7 4.3L21 15M21 20v-5h-5" /></svg>{busy === 'sync' || sync?.running ? 'Odświeżanie…' : 'Odśwież teraz'}</button>}
          <button type="button" className={`btn ${google.connected ? 'ghost' : 'primary'}`} disabled={!!busy} onClick={() => void connect()}>{busy === 'auth' ? 'Przekierowanie…' : google.connected ? 'Autoryzuj ponownie' : 'Autoryzuj konto Google'}</button></div>
        <p className="sub" style={{ margin: 0 }}>Zakresy obejmują tylko odczyt aktywności i pomiarów; nie ma zapisu do Google.</p>
      </>}</section>
    <section className="panel src"><header><h3>Google Takeout</h3><span className="tag">historia</span></header>
      <dl className="kv"><dt>Rola</dt><dd>punkt odniesienia; nie dubluje danych z API</dd><dt>Pliki</dt><dd>zachowane bez zmian, ze skrótem</dd></dl>
      <div className="actions"><button type="button" className="btn" onClick={onImports}>Importuj eksport</button></div></section>
    <section className="panel src future"><header><h3>Health Connect</h3><span className="tag">M8</span></header><p className="sub" style={{ margin: 0 }}>Opcjonalne źródło i cel zapisu przez przyszły komponent Android. Teraz niedostępne.</p></section>
    <section className="panel src future"><header><h3>Źródła jedzenia</h3><span className="tag food">M3–M4</span></header><p className="sub" style={{ margin: 0 }}>Open Food Facts, FatSecret i obecny arkusz posiłków. Pojawią się z dziennikiem.</p></section>
    <section className="panel src future"><header><h3>Zapis do Google / Connect</h3><span className="tag">M7</span></header><p className="sub" style={{ margin: 0 }}>Osobny podgląd, potwierdzenie i wynik dla każdej operacji. Aplikacja działa bez tego.</p></section>
  </div>;
}

/** Calendar of the year's days covered by a complete read after the day ended, for every refreshed kind. */
function Coverage() {
  const coverage = useJson('/api/google/coverage', coverageSchema);
  if (coverage.error) return <section className="panel"><p role="alert">Nie udało się odczytać pokrycia historii (magazyn niedostępny lub Google nie jest skonfigurowany).</p></section>;
  if (!coverage.data) return <section className="panel"><p>Ładowanie…</p></section>;
  const { days, kinds } = coverage.data, today = warsawToday(), year = coverage.data.from.slice(0, 4);
  const byDate = new Map(days.map((day) => [day.date, day.covered]));
  const start = mondayOf(`${year}-01-01`), end = `${year}-12-31`, weeks = Math.ceil((diffDays(start, end) + 1) / 7), cs = 12, gp = 2, W = 24 + weeks * (cs + gp);
  const cells = [];
  for (let week = 0; week < weeks; week++) for (let row = 0; row < 7; row++) {
    const date = addDays(start, week * 7 + row); if (date < `${year}-01-01` || date > end) continue;
    const covered = byDate.get(date);
    const fill = date === today ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : date > today || covered === undefined ? 'transparent' : covered === kinds ? 'color-mix(in srgb, var(--accent) 70%, transparent)' : covered === 0 ? 'var(--bad)' : 'var(--warn)';
    const label = date === today ? 'w toku' : date > today ? 'przyszłość' : covered === undefined ? 'poza zakresem' : covered === kinds ? 'pokryte' : covered === 0 ? 'brak odczytu' : `pokryte ${covered} z ${kinds} rodzajów`;
    cells.push(<rect key={date} x={24 + week * (cs + gp)} y={14 + row * (cs + gp)} width={cs} height={cs} rx={2} fill={fill} stroke={date > today ? 'var(--line)' : 'none'}><title>{`${date} · ${label}`}</title></rect>);
  }
  const gaps = days.filter((day) => day.covered < kinds).length;
  return <section className="panel"><header><h3>Doby {year} pokryte odczytem po końcu doby</h3><div className="legend"><span><i style={{ background: 'color-mix(in srgb, var(--accent) 70%, transparent)' }} />wszystkie rodzaje</span><span><i style={{ background: 'var(--warn)' }} />część rodzajów</span><span><i style={{ background: 'var(--bad)' }} />brak odczytu</span><span><i style={{ border: '1px solid var(--line)' }} />przyszłość</span></div></header>
    <div className="heat"><svg viewBox={`0 0 ${W} ${14 + 7 * (cs + gp)}`} width={W} style={{ maxWidth: 'none', display: 'block' }}>
      {MON.map((month, index) => { const first = `${year}-${String(index + 1).padStart(2, '0')}-01`; return <text key={month} x={24 + Math.floor(diffDays(start, first) / 7) * (cs + gp)} y={9}>{month}</text>; })}
      {['pn', '', 'śr', '', 'pt', '', 'nd'].map((label, row) => <text key={row} x={0} y={14 + row * (cs + gp) + 10}>{label}</text>)}{cells}</svg></div>
    <p className="sub" style={{ margin: '10px 0 0' }}>{gaps === 0 ? 'Wszystkie zakończone doby są pokryte.' : `Doby z luką: ${gaps}. Uzupełnianie poniżej działa w serwerze i przetrwa zamknięcie karty.`}</p></section>;
}

function SyncKinds({ sync }: { sync: SyncStatus | undefined }) {
  return <section className="panel"><header><h3>Odczyty według rodzaju</h3><span className="sub">{syncText(sync)}</span></header>
    {!sync ? <p>Ładowanie…</p> : <div className="tw"><table className="simple"><thead><tr><th>Rodzaj</th><th>Ostatni odczyt</th><th>Pokryte do</th></tr></thead><tbody>
      {sync.kinds.map((item) => <tr key={item.kind}><td>{syncLabels[item.kind] ?? item.kind}</td><td>{item.lastReadAt ? whenOf(item.lastReadAt) : 'brak zapisanego odczytu'}</td><td className="mono">{item.coveredThrough ?? '—'}</td></tr>)}</tbody></table></div>}</section>;
}
const googleJobSchema = z.object({ id: z.uuid(), kind: z.enum(['weight', 'body-fat', 'steps', 'distance', 'total-calories', 'active-energy-burned', 'heart-rate-10m', 'active-energy-10m', 'total-calories-10m', 'steps-10m', 'distance-10m', 'steps-sources', 'active-energy-sources']), start: z.string().max(40), end: z.string().max(40), state: z.enum(['running', 'complete']), createdAt: z.iso.datetime(), pages: z.number().int().nonnegative() });
function googleJobsError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'migration_required') return 'Wersja magazynu wymaga migracji z kopią zapasową.';
  if (code === 'store_unavailable') return 'Nie można otworzyć magazynu. Sprawdź lokalizację bazy i dostęp do pliku.';
  if (code === 'service_unavailable') return 'Usługa odczytu Google jest niedostępna. Sprawdź konfigurację serwera i lokalizację bazy.';
  if (code === 'invalid_jobs_response') return 'Serwer zwrócił nieoczekiwany format listy zadań. Sprawdź wersje serwera i interfejsu.';
  return 'Nie udało się pobrać listy zadań Google. Sprawdź połączenie z serwerem i spróbuj ponownie.';
}

const syncLabels: Record<string, string> = { steps: 'Kroki', distance: 'Dystans', 'total-calories': 'Kalorie total', 'active-energy-burned': 'Kalorie aktywne', 'heart-rate-10m': 'Tętno (okna)', 'active-energy-10m': 'Kalorie aktywne (okna)', 'total-calories-10m': 'Kalorie total (okna)', 'steps-10m': 'Kroki (okna)', 'distance-10m': 'Dystans (okna)', 'steps-sources': 'Źródła kroków', 'active-energy-sources': 'Źródła kalorii aktywnych', weight: 'Masa ciała', 'body-fat': 'Tkanka tłuszczowa' };

const backfillSchema = z.object({
  state: z.enum(['idle', 'running', 'stopping', 'stopped', 'done', 'error']), from: z.string(), through: z.string(),
  startedAt: z.string().nullable(), finishedAt: z.string().nullable(), readsThisRun: z.number(), code: z.string().optional(), retryAt: z.string().optional(),
  current: z.object({ kind: z.string(), first: z.string(), last: z.string() }).nullable(),
  kinds: z.array(z.object({ kind: z.string(), covered: z.number(), total: z.number() })),
});
const backfillStateText: Record<z.infer<typeof backfillSchema>['state'], string> = { idle: 'Nie uruchomiono w tej sesji serwera.', running: 'Trwa uzupełnianie.', stopping: 'Zatrzymywanie po bieżącej paczce…', stopped: 'Zatrzymano; zapisane paczki zostają.', done: 'Zakończono: wszystkie doby zakresu są pokryte.', error: 'Przerwano z powodu błędu; zapisane paczki zostają.' };
/** Progress lives on the server and in the store, so it survives a page reload, a closed tab and a server restart. */
function GoogleBackfill() {
  const [status, setStatus] = useState<z.infer<typeof backfillSchema> | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  async function load() {
    const response = await fetch('/api/google/sync-status');
    if (!response.ok) throw new Error('Status');
    setStatus(z.object({ backfill: backfillSchema }).parse(await response.json()).backfill);
  }
  useEffect(() => { void load().catch(() => setError(true)); }, []);
  const active = status?.state === 'running' || status?.state === 'stopping';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load().then(() => setError(false), () => setError(true)), 2000);
    return () => clearInterval(timer);
  }, [active]);
  async function send(action: 'start' | 'stop') {
    setBusy(true); setError(false);
    try {
      const response = await fetch('/api/google/backfill', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error('Uzupełnianie');
      setStatus(backfillSchema.parse(await response.json()));
    } catch { setError(true); } finally { setBusy(false); }
  }
  const covered = status?.kinds.reduce((sum, item) => sum + item.covered, 0) ?? 0;
  const total = status?.kinds.reduce((sum, item) => sum + item.total, 0) ?? 0;
  return <section><h3>Uzupełnianie historii</h3>
    <p>Odczytuje z API zakończone doby od {status?.from ?? '2026-01-01'} do {status?.through ?? 'wczoraj'}, których nie pokrył jeszcze żaden pełny odczyt wykonany po końcu doby, w paczkach (okna 10 min po 13 dób, kalorie total po 14, listy źródeł po 7, masa i tkanka tłuszczowa po 30, pozostałe sumy po 90). Działa w serwerze, więc zamknięcie karty go nie przerywa; przy włączonym odświeżaniu automatycznym startuje samo, gdy zostają luki (także po restarcie serwera), a pokryte doby nie są czytane ponownie.</p>
    {error && <p role="alert">Nie udało się odczytać stanu lub zmienić uzupełniania.</p>}
    {status && <>
      <p role="status">{backfillStateText[status.state]}{status.code ? ` Kod: ${status.code}.` : ''}{status.retryAt ? ` Wstrzymane przez limit Google do ${status.retryAt}.` : ''}{status.current ? ` Bieżąca paczka: ${syncLabels[status.current.kind] ?? status.current.kind}, ${status.current.first} – ${status.current.last}.` : ''}{status.startedAt ? ` Odczyty w tym przebiegu: ${status.readsThisRun}.` : ''}</p>
      <p>Pokryte doby razem: {covered} z {total}{total > 0 ? ` (${Math.floor((covered / total) * 100)} %)` : ''}.</p>
      <ul>{status.kinds.map((item) => <li key={item.kind}>{syncLabels[item.kind] ?? item.kind}: <progress max={item.total} value={item.covered} aria-label={`${syncLabels[item.kind] ?? item.kind}: pokryte doby`} /> {item.covered} z {item.total}</li>)}</ul>
      {active ? <button type="button" disabled={busy || status.state === 'stopping'} onClick={() => void send('stop')}>Zatrzymaj po bieżącej paczce</button>
        : <button type="button" disabled={busy || covered === total} onClick={() => void send('start')}>{status.startedAt || covered > 0 ? 'Wznów uzupełnianie' : 'Uzupełnij historię'}</button>}
    </>}
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
  return <section><h3>Odczyt próbny</h3><p>Jedno zadanie obejmuje wybrany dzień i rodzaj pomiaru; masa i tłuszcz używają dnia warszawskiego, kroki, dystans i kalorie doby cywilnej producenta. Przygotowanie zapisuje zadanie; pobranie strony odczytuje jedną porcję danych Google. Odczyt próbny nie zmienia tabeli dni poza tym, że jego oryginały są brane pod uwagę przy kolejnym przeliczeniu; nie jest łączony z Takeout.</p>
    <label>Rodzaj <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as typeof kind)}><optgroup label="Pomiary (doba warszawska)"><option value="weight">Masa ciała</option><option value="body-fat">Tkanka tłuszczowa</option></optgroup><optgroup label="Sumy dobowe (doba producenta)"><option value="steps">Kroki — suma doby</option><option value="distance">Dystans — suma doby</option><option value="total-calories">Kalorie total — suma doby (zawiera BMR)</option><option value="active-energy-burned">Kalorie aktywne — suma doby</option></optgroup><optgroup label="Okna 10 min (doba warszawska)"><option value="heart-rate-10m">Tętno — okna 10 min</option><option value="active-energy-10m">Kalorie aktywne — okna 10 min</option><option value="total-calories-10m">Kalorie total — okna 10 min</option><option value="steps-10m">Kroki — okna 10 min</option><option value="distance-10m">Dystans — okna 10 min</option></optgroup></select></label>{' '}
    <label>Data w Warszawie <input type="date" min="2026-01-01" max="9998-12-31" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /></label>{' '}
    {daily && <><label>Do dnia (włącznie, opcjonalnie; do {kind === 'total-calories' ? 14 : 90} dób) <input type="date" min={date} max="9998-12-31" value={lastDate} disabled={busy} onChange={(event) => setLastDate(event.target.value)} /></label>{' '}</>}
    <button type="button" disabled={busy || !date || !jobs || rangeInvalid} onClick={() => void run('/api/google/jobs', daily && lastDate ? { kind, start: date, end: nextCivilDay(lastDate) } : { kind, date })}>Przygotuj zadanie</button>
    {message && <p role="status">{message}</p>}
    {!jobs && <button type="button" disabled={busy} onClick={retry}>Ponów odczyt listy zadań</button>}
    {jobs && jobs.length > 0 && <div className="table-wrap"><table><thead><tr><th>Typ</th><th>Zakres UTC / doby</th><th>Stan</th><th>Strony</th><th>Akcja</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>{({ weight: 'Masa ciała', 'body-fat': 'Tkanka tłuszczowa', steps: 'Kroki — suma doby', distance: 'Dystans — suma doby', 'total-calories': 'Kalorie total — suma doby', 'active-energy-burned': 'Kalorie aktywne — suma doby', 'heart-rate-10m': 'Tętno — okna 10 min', 'active-energy-10m': 'Kalorie aktywne — okna 10 min', 'total-calories-10m': 'Kalorie total — okna 10 min', 'steps-10m': 'Kroki — okna 10 min', 'distance-10m': 'Dystans — okna 10 min', 'steps-sources': 'Źródła kroków', 'active-energy-sources': 'Źródła kalorii aktywnych' })[job.kind]}</td><td>{job.start} – {job.end}{job.kind === 'steps' || job.kind === 'distance' || job.kind === 'total-calories' || job.kind === 'active-energy-burned' ? ' (doba producenta)' : job.kind.endsWith('-sources') ? ' (doby cywilne)' : ''}</td><td>{job.state === 'complete' ? 'Odczyt zakończony' : 'Do kontynuacji'}</td><td>{job.pages}</td><td>{job.state === 'running' && <button type="button" disabled={busy} onClick={() => void run('/api/google/jobs/next', { id: job.id })}>Pobierz stronę</button>}</td></tr>)}</tbody></table></div>}
  </section>;
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
