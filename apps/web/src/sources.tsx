import { useEffect, useState } from 'react';
import { z } from 'zod';
import { sourcePageSchema, type SourceKind, type SourcePage } from '../../../packages/contracts/source-records.ts';
import { coverageSchema, post, useJson, type SyncStatus } from './api.ts';
import { addDays, diffDays, firstDay, MON, mondayOf, warsawToday, whenOf } from './format.ts';
import { Segmented } from './zoom.tsx';
import { CsvImport } from './csv-import.tsx';
import { Loading } from './logo.tsx';

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
  if (tab === 'pokrycie') return <>{head}<CoverageYears /><section className="panel legacy"><GoogleBackfill /></section></>;
  if (tab === 'importy') return <>{head}<section className="panel legacy"><CsvImport /></section><section className="panel legacy"><TakeoutImport onComplete={() => undefined} /></section><section className="panel legacy"><SourceRecords /></section></>;
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

/** Year picker over the coverage calendar: the current year by default, earlier years after a history read. */
function CoverageYears() {
  const current = Number(warsawToday().slice(0, 4));
  const [year, setYear] = useState(current);
  const years: [number, string][] = Array.from({ length: Math.min(current - Number(firstDay.slice(0, 4)) + 1, 8) }, (_, index) => current - index).reverse().map((value) => [value, String(value)]);
  return <><div className="toolbar"><Segmented label="Rok" items={years} value={year} onChange={setYear} />
    <label className="check">inny rok <input type="number" min={Number(firstDay.slice(0, 4))} max={current} value={year} aria-label="Rok kalendarza pokrycia" style={{ width: '6em' }} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= Number(firstDay.slice(0, 4)) && value <= current) setYear(value); }} /></label></div>
    <Coverage year={year} /></>;
}

/** Calendar of the year's days covered by a complete read after the day ended, for every refreshed kind. */
function Coverage({ year: selected }: { year: number }) {
  const coverage = useJson(`/api/google/coverage?year=${selected}`, coverageSchema);
  if (coverage.error) return <section className="panel"><p role="alert">Nie udało się odczytać pokrycia historii (magazyn niedostępny lub Google nie jest skonfigurowany).</p></section>;
  if (!coverage.data) return <section className="panel"><Loading /></section>;
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
  const gaps = days.filter((day) => day.covered < kinds).length, covered = days.some((day) => day.covered > 0);
  return <section className="panel"><header><h3>Doby {year} pokryte odczytem po końcu doby</h3><div className="legend"><span><i style={{ background: 'color-mix(in srgb, var(--accent) 70%, transparent)' }} />wszystkie rodzaje</span><span><i style={{ background: 'var(--warn)' }} />część rodzajów</span><span><i style={{ background: 'var(--bad)' }} />brak odczytu</span><span><i style={{ border: '1px solid var(--line)' }} />przyszłość</span></div></header>
    <div className="heat"><svg viewBox={`0 0 ${W} ${14 + 7 * (cs + gp)}`} width={W} style={{ maxWidth: 'none', display: 'block' }}>
      {MON.map((month, index) => { const first = `${year}-${String(index + 1).padStart(2, '0')}-01`; return <text key={month} x={24 + Math.floor(diffDays(start, first) / 7) * (cs + gp)} y={9}>{month}</text>; })}
      {['pn', '', 'śr', '', 'pt', '', 'nd'].map((label, row) => <text key={row} x={0} y={14 + row * (cs + gp) + 10}>{label}</text>)}{cells}</svg></div>
    <p className="sub" style={{ margin: '10px 0 0' }}>{days.length === 0 ? 'Ten rok nie ma jeszcze zakończonych dób.' : gaps === 0 ? 'Wszystkie zakończone doby są pokryte.' : `Doby z luką: ${gaps}.${!covered && year < '2026' ? ' Lata przed 2026 nie są czytane automatycznie: wybierz w uzupełnianiu poniżej datę początkową z tego roku.' : ' Uzupełnianie poniżej działa w serwerze i przetrwa zamknięcie karty.'}`} Doba odczytana bez danych producenta też jest pokryta (brak, nie zero).</p></section>;
}

function SyncKinds({ sync }: { sync: SyncStatus | undefined }) {
  return <section className="panel"><header><h3>Odczyty według rodzaju</h3><span className="sub">{syncText(sync)}</span></header>
    {!sync ? <Loading /> : <div className="tw"><table className="simple"><thead><tr><th>Rodzaj</th><th>Ostatni odczyt</th><th>Pokryte do</th></tr></thead><tbody>
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
  retrying: z.object({ attempt: z.number(), of: z.number(), at: z.string(), code: z.string() }).optional(),
  kinds: z.array(z.object({ kind: z.string(), covered: z.number(), total: z.number() })), remainingReads: z.number().nullable(),
});
/** "ok. 1 h 20 min" for a duration in milliseconds. */
function durationText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000)), hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
}
/**
 * Remaining time from the pace of this run (reads per elapsed time, including waits for Google limits); shown after
 * three reads, so the first slow request does not dominate. An estimate, not a promise.
 */
export function backfillEta(status: { state: string; startedAt: string | null; readsThisRun: number; remainingReads: number | null }, nowMs: number): number | null {
  if (status.state !== 'running' || !status.startedAt || status.readsThisRun < 3 || status.remainingReads === null) return null;
  const elapsed = nowMs - Date.parse(status.startedAt);
  return elapsed > 0 ? elapsed / status.readsThisRun * status.remainingReads : null;
}
const backfillStateText: Record<z.infer<typeof backfillSchema>['state'], string> = { idle: 'Nie uruchomiono w tej sesji serwera', running: 'Trwa uzupełnianie', stopping: 'Zatrzymywanie po bieżącej paczce…', stopped: 'Zatrzymano; odczytane paczki zostają', done: 'Zakończono', error: 'Przerwano z powodu błędu; zapisane paczki zostają.' };
const fromKey = 'trivimo-backfill-from';
/** Progress lives on the server and in the store, so it survives a page reload, a closed tab and a server restart. */
function GoogleBackfill() {
  const [status, setStatus] = useState<z.infer<typeof backfillSchema> | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<'' | 'load' | 'start' | 'stop'>('');
  // the last chosen start date is a per-browser convenience; the run itself lives on the server
  const [from, setFrom] = useState(() => { try { const saved = localStorage.getItem(fromKey); return saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : '2026-01-01'; } catch { return '2026-01-01'; } });
  const choose = (value: string) => { setFrom(value); try { localStorage.setItem(fromKey, value); } catch { /* not stored */ } };
  async function load() {
    const response = await fetch('/api/google/sync-status');
    if (!response.ok) throw new Error('Status');
    setStatus(z.object({ backfill: backfillSchema }).parse(await response.json()).backfill);
  }
  const reload = () => load().then(() => setError((current) => current === 'load' ? '' : current), () => setError('load'));
  useEffect(() => { void reload(); }, []);
  const active = status?.state === 'running' || status?.state === 'stopping';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [active]);
  async function send(action: 'start' | 'stop') {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/google/backfill', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: JSON.stringify(action === 'start' ? { action, from } : { action }) });
      if (!response.ok) throw new Error('Uzupełnianie');
      setStatus(backfillSchema.parse(await response.json()));
    } catch { setError(action); } finally { setBusy(false); }
  }
  const covered = status?.kinds.reduce((sum, item) => sum + item.covered, 0) ?? 0;
  const total = status?.kinds.reduce((sum, item) => sum + item.total, 0) ?? 0;
  const percent = total > 0 ? Math.floor((covered / total) * 100) : null;
  const eta = status ? backfillEta(status, Date.now()) : null;
  const yesterday = addDays(warsawToday(), -1);
  const failed = error !== '' || status?.state === 'error';
  // one line above the bar: progress, or the error in its place ("Przerwano - błąd serwera (kod: …). Spróbuj ponownie")
  const reason = (code: string | undefined) => !code ? 'błąd' : code === 'authorization_required' || code === 'scope_missing' ? 'wymagana ponowna autoryzacja Google' : code === 'rate_limited' || /429$/.test(code) ? 'limit zapytań Google'
    : /^google_(identity_)?http_5\d\d$/.test(code) || code === 'google_read_failed' ? 'błąd serwera' : code === 'migration_required' || code === 'store_unavailable' ? 'magazyn niedostępny' : 'błąd';
  const line = error === 'load' ? <>Nie udało się odczytać stanu uzupełniania. Spróbuj ponownie</>
    : error ? <>Nie udało się {error === 'stop' ? 'zatrzymać' : 'uruchomić'} uzupełniania. Spróbuj ponownie</>
      : !status ? <Loading size="inline" />
        : status.state === 'error' ? <>Przerwano - {reason(status.code)}{status.code ? ` (kod: ${status.code})` : ''}. Spróbuj ponownie</>
          : active && status.retrying ? <>Pobieranie od {status.from} · {reason(status.retrying.code)} (kod: {status.retrying.code}), ponowienie {whenOf(status.retrying.at)} (próba {status.retrying.attempt} z {status.retrying.of})</>
            : active ? <>Pobieranie od {status.from}{percent !== null ? <> · <b>{percent} %</b></> : null}{eta !== null ? <span className="faint"> · zostało {durationText(eta)}</span> : null}{status.retryAt ? <span className="faint"> · limit Google do {whenOf(status.retryAt)}</span> : null}</>
              : <>{backfillStateText[status.state]}{percent !== null ? <> · <b>{percent} %</b></> : null}</>;
  return <section><h3>Uzupełnianie historii</h3>
    {/* no run in this server session: nothing to report, so neither the line nor the bar is shown */}
    {(failed || (status && status.state !== 'idle')) && <div className={`bf-msg ${failed || (active && status?.retrying) ? 'bad' : ''}`} role={failed ? 'alert' : 'status'}>
      <span>{line}</span>
      {status && <progress max={total || 1} value={covered} aria-label="Postęp uzupełniania historii" />}
    </div>}
    {status && (active ? <button type="button" disabled={busy || status.state === 'stopping'} onClick={() => void send('stop')}>Zatrzymaj</button>
      : <div className="bf-start"><label>Od dnia <input type="date" min={firstDay} max={yesterday} value={from} disabled={busy} onChange={(event) => { if (event.target.value) choose(event.target.value); }} /></label>
        <button type="button" disabled={busy || !from || from < firstDay || from > yesterday} onClick={() => void send('start')}>{status.from === from && (status.startedAt || covered > 0) ? 'Wznów uzupełnianie' : 'Uzupełnij historię'}</button></div>)}
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
    <label>Data w Warszawie <input type="date" min={firstDay} max="9998-12-31" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /></label>{' '}
    {daily && <><label>Do dnia (włącznie, opcjonalnie; do {kind === 'total-calories' ? 14 : 90} dób) <input type="date" min={date} max="9998-12-31" value={lastDate} disabled={busy} onChange={(event) => setLastDate(event.target.value)} /></label>{' '}</>}
    <button type="button" disabled={busy || !date || !jobs || rangeInvalid} onClick={() => void run('/api/google/jobs', daily && lastDate ? { kind, start: date, end: nextCivilDay(lastDate) } : { kind, date })}>Przygotuj zadanie</button>
    {message && <p role="status">{message}</p>}
    {!jobs && <button type="button" disabled={busy} onClick={retry}>Ponów odczyt listy zadań</button>}
    {jobs && jobs.length > 0 && <div className="table-wrap"><table><thead><tr><th>Typ</th><th>Zakres UTC / doby</th><th>Stan</th><th>Strony</th><th>Akcja</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>{({ weight: 'Masa ciała', 'body-fat': 'Tkanka tłuszczowa', steps: 'Kroki — suma doby', distance: 'Dystans — suma doby', 'total-calories': 'Kalorie total — suma doby', 'active-energy-burned': 'Kalorie aktywne — suma doby', 'heart-rate-10m': 'Tętno — okna 10 min', 'active-energy-10m': 'Kalorie aktywne — okna 10 min', 'total-calories-10m': 'Kalorie total — okna 10 min', 'steps-10m': 'Kroki — okna 10 min', 'distance-10m': 'Dystans — okna 10 min', 'steps-sources': 'Źródła kroków', 'active-energy-sources': 'Źródła kalorii aktywnych' })[job.kind]}</td><td>{job.start} – {job.end}{job.kind === 'steps' || job.kind === 'distance' || job.kind === 'total-calories' || job.kind === 'active-energy-burned' ? ' (doba producenta)' : job.kind.endsWith('-sources') ? ' (doby cywilne)' : ''}</td><td>{job.state === 'complete' ? 'Odczyt zakończony' : 'Do kontynuacji'}</td><td>{job.pages}</td><td>{job.state === 'running' && <button type="button" disabled={busy} onClick={() => void run('/api/google/jobs/next', { id: job.id })}>Pobierz stronę</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}

const zipErrors: Record<string, string> = {
  zip_invalid: 'Plik nie jest poprawnym archiwum ZIP (albo jest niekompletny).', zip_truncated: 'Archiwum jest niekompletne.', zip_encrypted: 'Archiwum jest zaszyfrowane.',
  zip_unsupported_method: 'Archiwum używa nieobsługiwanej kompresji.', zip_symlink: 'Archiwum zawiera dowiązanie symboliczne; nie zostało rozpakowane.', zip_unsafe_path: 'Archiwum zawiera niebezpieczną ścieżkę; nie zostało rozpakowane.',
  zip_too_many_entries: 'Za dużo plików Google Health w archiwum (limit 5000).', zip_entry_too_large: 'Plik w archiwum przekracza 32 MiB.', zip_ratio: 'Podejrzany współczynnik kompresji; archiwum odrzucone.',
  zip_too_large: 'Pliki Google Health po rozpakowaniu przekraczają 4 GiB.', zip_checksum: 'Suma kontrolna pliku w archiwum się nie zgadza.', zip_size_mismatch: 'Rozmiar pliku w archiwum się nie zgadza.',
  upload_too_large: 'Archiwum jest za duże (do 64 GiB).', upload_missing: 'Wysłane archiwum wygasło. Wybierz plik ponownie.', no_google_health: 'Archiwum nie zawiera folderu „Google Health”. Wybierz eksport Takeout z danymi Fitbit/Google Health.',
};
/** POST one file with upload progress (fetch has no upload progress). */
function uploadZip(file: File, onProgress: (sent: number) => void): Promise<{ id: string; entries: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/takeout/upload');
    request.setRequestHeader('Content-Type', 'application/zip'); request.setRequestHeader('X-Trivimo-Request', '1');
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      let data: unknown = null; try { data = JSON.parse(request.responseText); } catch { /* not JSON */ }
      if (request.status === 200 && typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string') resolve({ id: data.id, entries: Number((data as { entries?: unknown }).entries) });
      else { const code = typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : ''; reject(new Error(zipErrors[code] ?? 'Nie udało się wysłać archiwum do serwera aplikacji.')); }
    };
    request.onerror = () => reject(new Error('Nie można połączyć się z serwerem aplikacji.'));
    request.send(file);
  });
}

function TakeoutImport({ onComplete }: { onComplete: () => void }) {
  const [archives, setArchives] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ stage: 'upload' | 'extract'; sent: number; total: number; started: number } | null>(null);
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
      if (endpoint === 'preview') {
        // send each part, then let the server extract the Google Health folders and plan the import
        const total = archives.reduce((sum, file) => sum + file.size, 0), started = Date.now(), ids: string[] = [];
        let before = 0;
        for (const file of archives) {
          setProgress({ stage: 'upload', sent: before, total, started });
          ids.push((await uploadZip(file, (sent) => setProgress({ stage: 'upload', sent: before + sent, total, started }))).id);
          before += file.size;
        }
        setProgress({ stage: 'extract', sent: total, total, started });
        body = { uploads: ids, sameAccount: (body as { sameAccount?: boolean }).sameAccount ?? false };
      }
      const response = await fetch(endpoint === 'preview' ? '/api/takeout/zip-preview' : `/api/takeout/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' }, body: JSON.stringify(body) });
      const data: unknown = await response.json();
      if (!response.ok) {
        const code = typeof data === 'object' && data !== null && 'error' in data ? data.error : '';
        throw new Error(typeof code === 'string' && zipErrors[code] ? zipErrors[code] : code === 'pending_other' ? 'Niedokończony import dotyczy innego archiwum. Wybierz to samo archiwum (te same pliki), aby go wznowić.' : code === 'pending_account_locked' ? 'Wznawiany plan nie miał przypisanego konta; odznacz wybór, aby zachować jego zapisane decyzje.' : code === 'account_unavailable' ? 'Nie można jednoznacznie wybrać wcześniejszego konta.' : code === 'plan_changed' ? 'Pliki lub stan importu zmieniły się. Przygotuj podgląd ponownie.' : code === 'preview_expired' ? 'Podgląd wygasł. Przygotuj go ponownie.' : code === 'invalid_directory' ? 'Podaj pełną ścieżkę do katalogu.' : code === 'no_files' ? 'Nie znaleziono plików Google Health w tym katalogu.' : code === 'unsupported_schema' ? 'Eksport zawiera nieobsługiwany układ kolumn.' : code === 'invalid_csv' ? 'Eksport zawiera nieprawidłowy plik CSV lub nieobsługiwane kodowanie.' : 'Nie udało się odczytać katalogu lub zapisać danych. Sprawdź ścieżkę i dostęp serwera.');
      }
      if (endpoint === 'preview') {
        if (typeof data !== 'object' || data === null || !('token' in data) || typeof data.token !== 'string' || !('files' in data) || typeof data.files !== 'number' || !('rows' in data) || typeof data.rows !== 'number' || !('resuming' in data) || typeof data.resuming !== 'boolean' || !('accountLinked' in data) || typeof data.accountLinked !== 'boolean') throw new Error('Nieprawidłowa odpowiedź serwera.');
        setPreview({ token: data.token, files: data.files, rows: data.rows, resuming: data.resuming, accountLinked: data.accountLinked });
      } else { setDone(true); setPreview(null); try { const state = await fetch('/api/source-account'); if (state.ok) { const account = await state.json() as { unassignedImports?: number }; if (typeof account.unassignedImports === 'number') setUnassignedImports(account.unassignedImports); } } catch { /* Import was already committed. */ } }
    } catch (failure) { setError(failure instanceof TypeError ? 'Nie można połączyć się z serwerem aplikacji.' : failure instanceof Error ? failure.message : 'Nie udało się wykonać operacji.'); if (endpoint === 'import') setPreview(null); }
    finally { setBusy(false); setProgress(null); }
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
    <p>Wybierz archiwum .zip z Google Takeout (eksport w kilku częściach: zaznacz wszystkie części naraz). Aplikacja wyśle je do lokalnego serwera, rozpakuje tylko folder „Google Health” i przygotuje podgląd; zapis rozpocznie się po Twoim potwierdzeniu. Wysłane archiwum jest usuwane po rozpakowaniu, a rozpakowane pliki po udanym imporcie (po przerwanym zostają, żeby to samo archiwum wznowiło import).</p>
    <label>Archiwum Takeout <input type="file" accept=".zip,application/zip" multiple disabled={busy} onChange={(event) => { setArchives([...(event.target.files ?? [])]); setPreview(null); setDone(false); setError(''); }} /></label>
    {archives.length > 0 && <p className="sub">{archives.map((file) => file.name).join(', ')} · {(archives.reduce((sum, file) => sum + file.size, 0) / 1024 ** 2).toFixed(0)} MB</p>}
    {progress && <div role="status"><progress max={progress.total || 1} value={progress.stage === 'extract' ? undefined : progress.sent} aria-label="Postęp wysyłania archiwum" style={{ width: '100%' }} />
      <p className="sub">{progress.stage === 'upload' ? `Wysyłanie: ${Math.floor(progress.sent / Math.max(progress.total, 1) * 100)} %${progress.sent > 0 && Date.now() - progress.started > 2000 ? ` · pozostało ok. ${Math.max(1, Math.round((Date.now() - progress.started) / progress.sent * (progress.total - progress.sent) / 1000))} s` : ''}` : 'Rozpakowywanie folderu Google Health i przygotowanie podglądu…'}</p></div>}
    {accountAvailable && <label className="account-choice"><input type="checkbox" checked={sameAccount} disabled={busy} onChange={(event) => { setSameAccount(event.target.checked); setPreview(null); setDone(false); }} /> Ten eksport pochodzi z tego samego konta Google co wcześniejszy import.</label>}
    <button type="button" disabled={busy || archives.length === 0} onClick={() => void submit('preview', { sameAccount })}>{busy ? 'Przetwarzanie…' : 'Przygotuj podgląd'}</button>
    {preview && <div><p>{preview.resuming ? 'Wznowienie zapisanego planu.' : 'Podgląd importu.'} Pliki: {preview.files}, wiersze rozpoznanych typów: {preview.rows}. {preview.accountLinked ? 'Import będzie przypisany do wcześniej potwierdzonego konta.' : 'Import pozostanie bez przypisanego konta.'} Pozostałe pliki Google Health zostaną zachowane jako oryginały. Identyczne pliki nie są zapisywane ponownie.</p><button type="button" disabled={busy} onClick={() => void submit('import', { token: preview.token })}>{busy ? 'Importowanie…' : preview.resuming ? 'Potwierdź wznowienie' : 'Potwierdź import'}</button></div>}
    {error && <p role="alert">{error}</p>}
    {done && <div><p role="status">Import zakończony; tymczasowe pliki rozpakowanego archiwum usunięto. Wartości dzienne nie zostały jeszcze wyliczone.</p><button type="button" onClick={onComplete}>Pokaż dane</button></div>}
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
    {error ? <div role="alert"><p>Nie udało się otworzyć bazy Takeout. Jeśli dane nie były jeszcze importowane, wybierz „Import Takeout”. W przeciwnym razie uruchom aplikację poza środowiskiem izolowanym i spróbuj ponownie.</p><button type="button" onClick={() => setAttempt(attempt + 1)}>Spróbuj ponownie</button></div> : loading || !page ? <Loading /> : page.rows.length === 0 ? <p>{sourceDate ? 'Brak wierszy dla wybranej daty.' : 'Brak wierszy tego typu w imporcie.'}</p> : <>
      <div className="table-wrap"><table><thead><tr><th>Czas źródła</th><th>Oryginał ({unit})</th><th>Po przeliczeniu</th><th>Źródło według eksportu</th></tr></thead>
        <tbody>{page.rows.map((row, index) => <tr key={`${cursor}-${index}`}><td>{row.timestamp || '—'}</td><td>{row.value || '—'}</td><td>{row.converted.status === 'parsed' ? `${row.converted.value.replace('.', ',')} ${row.converted.unit}` : row.converted.status === 'unsupported' ? 'Niepotwierdzona jednostka' : 'Nie można przeliczyć wartości'}</td><td>{row.source || '—'}</td></tr>)}</tbody></table></div>
      {history.length > 0 && <button type="button" onClick={() => { setCursor(history.at(-1)!); setHistory(history.slice(0, -1)); }}>Poprzednie</button>}
      {page.next !== null && <button type="button" onClick={() => { setHistory([...history, cursor]); setCursor(page.next!); }}>Następne 100</button>}
    </>}
  </section>;
}
