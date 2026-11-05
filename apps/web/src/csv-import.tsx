import { useEffect, useState } from 'react';
import { z } from 'zod';
import { csvDateFormats, csvMetrics, csvUnits, type CsvMapping, type CsvMetric } from '../../../packages/contracts/csv-import.ts';
import { guessDecimal } from '../../../packages/adapters/csv/decimal.ts';
import { post } from './api.ts';
import { whenOf } from './format.ts';
import { Loading } from './logo.tsx';

const inspectSchema = z.object({ delimiter: z.enum([',', ';', '\t']), columns: z.number().int().positive(), rows: z.number().int().nonnegative(), head: z.array(z.array(z.string())) });
const stat = z.object({ values: z.number(), days: z.number(), fills: z.number(), keepsGoogle: z.number() });
const previewSchema = z.object({
  token: z.string(), duplicate: z.boolean(), dataRows: z.number(), values: z.number(), empty: z.number(), rejected: z.number(),
  rejectedSample: z.array(z.object({ row: z.number(), metric: z.union([z.enum(csvMetrics), z.literal('note')]).nullable(), reason: z.string() })),
  first: z.string().nullable(), last: z.string().nullable(), days: z.number(), perMetric: z.record(z.string(), stat),
  notes: z.object({ values: z.number(), days: z.number(), create: z.number(), append: z.number(), unchanged: z.number(), tooLong: z.number() }).nullable(),
});
const importsSchema = z.array(z.object({ id: z.uuid(), fileName: z.string(), createdAt: z.string(), dataRows: z.number(), rejected: z.number(), values: z.number(), first: z.string().nullable(), last: z.string().nullable(), metrics: z.array(z.string()), notes: z.number(), state: z.enum(['included', 'excluded']), parser: z.string() }));

const metricLabels: Record<CsvMetric, string> = { weight: 'Masa ciała', body_fat: 'Tkanka tłuszczowa', steps: 'Kroki', distance: 'Dystans', total_energy: 'Spalone kalorie (total)', active_energy: 'Aktywne kalorie' };
const unitLabels: Record<string, string> = { kg: 'kg', g: 'g', lb: 'funty (lb)', '%': '%', fraction: 'ułamek (0–1)', count: 'szt.', km: 'km', m: 'm', mi: 'mile', kcal: 'kcal', kJ: 'kJ' };
const formatLabels: Record<CsvMapping['date']['format'], string> = { 'YYYY-MM-DD': 'RRRR-MM-DD', 'DD.MM.YYYY': 'DD.MM.RRRR', 'DD/MM/YYYY': 'DD/MM/RRRR', 'MM/DD/YYYY': 'MM/DD/RRRR', ISO_DATETIME: 'ISO 8601 z godziną (np. 2024-05-01T08:00:00+02:00)' };
const reasons: Record<string, string> = { invalid_date: 'nieczytelna data', date_out_of_range: 'data poza zakresem (przed 2000 r. lub w przyszłości)', invalid_time: 'nieczytelna godzina', invalid_number: 'nieczytelna liczba', out_of_range: 'wartość poza zakresem', not_integer: 'kroki nie są liczbą całkowitą', missing_column: 'brak kolumny w wierszu', note_too_long: 'uwaga dłuższa niż 10 000 znaków' };
const errors: Record<string, string> = { invalid_csv: 'Plik nie jest poprawnym CSV (cudzysłowy, kodowanie UTF-8).', empty_csv: 'Plik jest pusty.', too_many_rows: 'Plik ma więcej niż 200 000 wierszy.', too_many_columns: 'Plik ma więcej niż 256 kolumn.', plan_changed: 'Plik lub mapowanie zmieniły się po podglądzie. Przygotuj podgląd ponownie.', migration_required: 'Magazyn wymaga migracji do wersji 12 (npm run migrate:canonical z kopią).', store_unavailable: 'Nie można otworzyć magazynu aplikacji.', body_too_large: 'Plik jest za duży (do 8 MiB).', invalid_request: 'Nieprawidłowe mapowanie kolumn.', service_unavailable: 'Import CSV jest niedostępny (brak magazynu).' };

const datePatterns: [CsvMapping['date']['format'], RegExp][] = [['ISO_DATETIME', /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/], ['YYYY-MM-DD', /^\d{4}-\d{1,2}-\d{1,2}$/], ['DD.MM.YYYY', /^\d{1,2}\.\d{1,2}\.\d{4}$/], ['DD/MM/YYYY', /^\d{1,2}\/\d{1,2}\/\d{4}$/]];
const notePattern = /uwag|notat|note|comment|komentarz/i;
const guesses: [CsvMetric, RegExp][] = [['body_fat', /fat|tłuszcz|tkank/i], ['weight', /weight|waga|masa/i], ['steps', /step|krok/i], ['distance', /dist|dystans/i], ['active_energy', /activ|aktywn/i], ['total_energy', /total|spalon|calor|kalori|energ/i]];

/** First suggestion of a mapping from the header names and the first data row; the user checks and changes it. */
function suggest(head: string[][], delimiter: CsvMapping['delimiter']): CsvMapping {
  const names = head[0] ?? [], sample = head[1] ?? [];
  const header = names.some((name) => /[a-ząćęłńóśźż]/i.test(name)) && !datePatterns.some(([, pattern]) => pattern.test((names[0] ?? '').trim()));
  const dateColumn = Math.max(0, header ? names.findIndex((name) => /date|data|dzień|dzien|day|time|czas/i.test(name)) : sample.findIndex((cell) => datePatterns.some(([, pattern]) => pattern.test(cell.trim()))));
  const dateCell = (header ? sample : names)[dateColumn]?.trim() ?? '';
  const format = datePatterns.find(([, pattern]) => pattern.test(dateCell))?.[0] ?? 'YYYY-MM-DD';
  const metrics: CsvMapping['metrics'] = {};
  if (header) {
    const used = new Set<number>([dateColumn]);
    for (const [metric, pattern] of guesses) {
      const column = names.findIndex((name, index) => !used.has(index) && pattern.test(name));
      if (column < 0) continue;
      used.add(column);
      const name = names[column]!;
      const unit = metric === 'weight' ? (/\blbs?\b|funt/i.test(name) ? 'lb' : /\(g\)|\bgram/i.test(name) ? 'g' : 'kg') : metric === 'body_fat' ? '%' : metric === 'steps' ? 'count'
        : metric === 'distance' ? (/\bmi(les?)?\b|mil/i.test(name) ? 'mi' : /\(m\)|\bmetr/i.test(name) ? 'm' : 'km') : /kj/i.test(name) ? 'kJ' : 'kcal';
      (metrics as Record<string, { column: number; unit: string }>)[metric] = { column, unit };
    }
  }
  const note = header ? names.findIndex((name, index) => index !== dateColumn && notePattern.test(name)) : -1;
  // decimal separator from all sample data cells except the date and remarks ("88,9" quoted in a comma file counts)
  const cells = (header ? head.slice(1) : head).map((row) => row.filter((_, index) => index !== dateColumn && index !== note));
  return { delimiter, header, decimal: guessDecimal(cells, delimiter), date: { column: dateColumn, format }, time: null, dailyRows: 'single', ...(note >= 0 ? { note } : {}), metrics };
}

async function call<T>(path: string, body: object, schema: z.ZodType<T>): Promise<T> {
  const response = await post(path, body);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) { const code = typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : ''; throw new Error(errors[code] ?? 'Nie udało się wykonać operacji importu CSV.'); }
  return schema.parse(data);
}

/** Import of any CSV with a column mapping: values fill only days and metrics without a Google value (rule csv-fill-v1). */
export function CsvImport() {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [info, setInfo] = useState<z.infer<typeof inspectSchema> | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(null);
  const [busy, setBusy] = useState(false); const [formKey, setFormKey] = useState(0); const [error, setError] = useState(''); const [done, setDone] = useState('');
  const [imports, setImports] = useState<z.infer<typeof importsSchema> | null>(null); const [listError, setListError] = useState(false);
  async function load() {
    try { const response = await fetch('/api/csv/imports'); if (!response.ok) throw new Error('list'); setImports(importsSchema.parse(await response.json())); setListError(false); } catch { setListError(true); }
  }
  useEffect(() => { void load(); }, []);
  const change = (next: CsvMapping) => { setMapping(next); setPreview(null); setDone(''); };

  async function choose(selected: File | undefined) {
    setFile(null); setInfo(null); setMapping(null); setPreview(null); setError(''); setDone('');
    if (!selected) return;
    if (selected.size > 8 * 1024 * 1024) { setError(errors.body_too_large!); return; }
    setBusy(true);
    try {
      const content = await selected.text(), next = { name: selected.name.slice(0, 255) || 'plik.csv', content };
      const inspected = await call('/api/csv/inspect', next, inspectSchema);
      setFile(next); setInfo(inspected); setMapping(suggest(inspected.head, inspected.delimiter));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Nie udało się odczytać pliku.'); } finally { setBusy(false); }
  }
  async function run(kind: 'preview' | 'import') {
    if (!file || !mapping) return;
    setBusy(true); setError('');
    try {
      if (kind === 'preview') setPreview(await call('/api/csv/preview', { ...file, mapping }, previewSchema));
      else {
        const name = file.name;
        const result = await call('/api/csv/import', { ...file, mapping, token: preview!.token }, z.object({ created: z.boolean(), notes: z.number(), published: z.number(), unchanged: z.number() }));
        // success: the form closes (as after a page reload), leaving the message and the list of imports
        setFile(null); setInfo(null); setMapping(null); setPreview(null); setFormKey((key) => key + 1);
        setDone(result.created ? `Import zakończony powodzeniem: ${name}. Przeliczone doby: ${result.published}.${result.notes ? ` Zapisane notatki dni: ${result.notes}.` : ''}` : `Plik ${name} z tym mapowaniem był już zaimportowany; nic nie zapisano ponownie.`);
        void load();
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Nie udało się wykonać operacji.'); if (kind === 'import') setPreview(null); } finally { setBusy(false); }
  }
  async function decide(id: string, state: 'included' | 'excluded') {
    setBusy(true); setError('');
    try { const result = await call('/api/csv/decision', { id, state }, z.object({ published: z.number(), notes: z.number() })); setDone(`${state === 'excluded' ? 'Import wycofany: jego wartości zniknęły z tabeli, a uwagi z notatek dni' : 'Import przywrócony'}. Przeliczone doby: ${result.published}. Zmienione notatki dni: ${result.notes}.`); void load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Nie udało się zmienić decyzji.'); } finally { setBusy(false); }
  }

  const names = info && mapping ? Array.from({ length: info.columns }, (_, index) => mapping.header ? `${index + 1}. ${info.head[0]?.[index] || '(bez nazwy)'}` : `Kolumna ${index + 1}`) : [];
  const columnSelect = (value: number | null, onChange: (value: number | null) => void, label: string, optional: boolean) => <select aria-label={label} value={value ?? ''} disabled={busy} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}>
    {optional && <option value="">— nie importuj —</option>}{names.map((name, index) => <option key={index} value={index}>{name}</option>)}</select>;
  const setMetric = (metric: CsvMetric, column: number | null, unit?: string) => {
    if (!mapping) return;
    const metrics = { ...mapping.metrics } as Record<string, { column: number; unit: string } | undefined>;
    if (column === null) delete metrics[metric]; else metrics[metric] = { column, unit: unit ?? metrics[metric]?.unit ?? csvUnits[metric][0] };
    change({ ...mapping, metrics: metrics as CsvMapping['metrics'] });
  };

  return <section className="import-panel"><h2>Import CSV z mapowaniem kolumn</h2>
    <p>Dowolny plik CSV (UTF-8, do 8 MiB): wybierz, które kolumny to data, nasze metryki i uwagi do dnia, oraz jednostki metryk. Wartości są przeliczane dokładnie (bez zaokrągleń) i <b>uzupełniają tylko braki</b>: doba i metryka, która ma wartość z Google (także nieporównywalną lub konfliktową), zostaje bez zmian. Plik, mapowanie i wersja parsera są zachowane; import można później wycofać (wartości i uwagi).</p>
    <label>Plik CSV <input key={formKey} type="file" accept=".csv,.tsv,.txt,text/csv" disabled={busy} onChange={(event) => void choose(event.target.files?.[0])} /></label>
    {info && mapping && file && <>
      <p className="sub">{file.name}: {info.rows} wierszy, {info.columns} kolumn. Pierwsze wiersze pliku (dane z pliku, tylko do podglądu):</p>
      <div className="tw"><table className="simple"><tbody>{info.head.map((row, index) => <tr key={index}>{Array.from({ length: info.columns }, (_, column) => <td key={column} className="l">{row[column] ?? ''}</td>)}</tr>)}</tbody></table></div>
      <fieldset disabled={busy}><legend>Format pliku</legend>
        <label>Separator <select value={mapping.delimiter} onChange={(event) => change({ ...mapping, delimiter: event.target.value as CsvMapping['delimiter'] })}><option value=",">przecinek</option><option value=";">średnik</option><option value={'\t'}>tabulator</option></select></label>{' '}
        <label className="check"><input type="checkbox" checked={mapping.header} onChange={(event) => change({ ...mapping, header: event.target.checked })} /> Pierwszy wiersz to nagłówki</label>{' '}
        <label>Separator dziesiętny <select value={mapping.decimal} onChange={(event) => change({ ...mapping, decimal: event.target.value as CsvMapping['decimal'] })}><option value=".">kropka (80.5)</option><option value=",">przecinek (80,5)</option></select></label>
        {mapping.delimiter !== info.delimiter && <p className="sub">Zmieniony separator: kolumny poniżej odpowiadają wykrytemu podziałowi; przygotuj podgląd, aby sprawdzić wynik.</p>}
      </fieldset>
      <fieldset disabled={busy}><legend>Data</legend>
        <label>Kolumna daty {columnSelect(mapping.date.column, (column) => change({ ...mapping, date: { ...mapping.date, column: column ?? 0 } }), 'Kolumna daty', false)}</label>{' '}
        <label>Format <select value={mapping.date.format} onChange={(event) => change({ ...mapping, date: { ...mapping.date, format: event.target.value as CsvMapping['date']['format'] } })}>{csvDateFormats.map((format) => <option key={format} value={format}>{formatLabels[format]}</option>)}</select></label>{' '}
        <label>Godzina pomiaru (opcjonalnie) {columnSelect(mapping.time, (column) => change({ ...mapping, time: column }), 'Kolumna godziny', true)}</label>
        <p className="sub">Data bez strefy jest dobą zapisaną w pliku (bez przeliczania); czas ISO ze strefą trafia do swojej doby warszawskiej.</p>
      </fieldset>
      <fieldset disabled={busy}><legend>Metryki</legend>
        <div className="tw"><table className="simple"><thead><tr><th className="l">Metryka w Trivimo</th><th className="l">Kolumna w pliku CSV</th><th className="l">Jednostka w pliku CSV</th></tr></thead><tbody>
          {csvMetrics.map((metric) => { const current = mapping.metrics[metric]; return <tr key={metric}><td className="l">{metricLabels[metric]}</td><td className="l">{columnSelect(current?.column ?? null, (column) => setMetric(metric, column), `Kolumna: ${metricLabels[metric]}`, true)}</td>
            <td className="l">{current ? <select aria-label={`Jednostka: ${metricLabels[metric]}`} value={current.unit} onChange={(event) => setMetric(metric, current.column, event.target.value)}>{csvUnits[metric].map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}</select> : <span className="faint">—</span>}</td></tr>; })}
          <tr><td className="l">Uwagi do dnia</td><td className="l">{columnSelect(mapping.note ?? null, (column) => { const { note: _, ...rest } = mapping; change(column === null ? rest : { ...rest, note: column }); }, 'Kolumna: Uwagi do dnia', true)}</td><td className="l"><span className="faint">tekst</span></td></tr>
        </tbody></table></div>
        <label>Kilka wierszy jednej doby dla kroków, dystansu i kalorii <select value={mapping.dailyRows} onChange={(event) => change({ ...mapping, dailyRows: event.target.value as CsvMapping['dailyRows'] })}><option value="single">to kopie sumy dobowej (różne wartości = konflikt)</option><option value="sum">to części doby — zsumuj je</option></select></label>
        <p className="sub">Masa i tkanka tłuszczowa: średnia unikalnych pomiarów doby (ta sama doba, godzina i wartość to jeden pomiar). Pusta komórka to brak wartości, nie zero. Wartość procentowa może mieć znak „%” (np. 20,90%). Uwagi są zapisywane jako notatki dni, tak jak wpisane w aplikacji: dzień bez notatki dostaje nową, a do istniejącej uwaga jest dopisywana w nowej linii (chyba że notatka już ją zawiera). Wycofanie importu usuwa z notatek dopisane przez niego linie (nowa rewizja notatki); resztę notatki zostawia.</p>
      </fieldset>
      <button type="button" className="btn" disabled={busy || (Object.keys(mapping.metrics).length === 0 && mapping.note === undefined)} onClick={() => void run('preview')}>{busy && !preview ? 'Przetwarzanie…' : 'Przygotuj podgląd'}</button>
    </>}
    {preview && <div role="status">
      <p>Wiersze danych: {preview.dataRows}. Wartości do zapisu: {preview.values}{preview.first ? `, doby ${preview.first} – ${preview.last} (${preview.days})` : ''}. Puste komórki: {preview.empty}. Odrzucone wartości: {preview.rejected}.{preview.duplicate ? ' Ten plik z tym mapowaniem jest już zaimportowany — zapis niczego nie powtórzy.' : ''}</p>
      <ul>{Object.entries(preview.perMetric).map(([metric, item]) => <li key={metric}>{metricLabels[metric as CsvMetric]}: {item.values} wartości w {item.days} dobach; uzupełni {item.fills}, pozostawi wartość Google w {item.keepsGoogle}.</li>)}
        {preview.notes && <li>Uwagi do notatek dni: {preview.notes.values} w {preview.notes.days} dobach; nowa notatka w {preview.notes.create}, dopisanie do istniejącej w {preview.notes.append}, bez zmian (notatka już ma ten tekst) w {preview.notes.unchanged}{preview.notes.tooLong ? `, pominięte (notatka przekroczyłaby 10 000 znaków) w ${preview.notes.tooLong}` : ''}.</li>}</ul>
      {preview.rejectedSample.length > 0 && <details><summary>Odrzucone (pierwsze {preview.rejectedSample.length})</summary><ul>{preview.rejectedSample.map((item, index) => <li key={index}>wiersz {item.row}{item.metric === 'note' ? ', uwagi' : item.metric ? `, ${metricLabels[item.metric]}` : ''}: {reasons[item.reason] ?? item.reason}</li>)}</ul></details>}
      <button type="button" className="btn primary" disabled={busy || preview.values + (preview.notes?.values ?? 0) === 0} onClick={() => void run('import')}>{busy ? 'Importowanie…' : 'Potwierdź import'}</button></div>}
    {error && <p role="alert">{error}</p>}
    {done && <p role="status">{done}</p>}
    <h3>Zaimportowane pliki CSV</h3>
    {listError ? <p role="alert">Nie udało się odczytać listy importów CSV (magazyn niedostępny lub wymaga migracji do wersji 12).</p> : !imports ? <Loading /> : imports.length === 0 ? <p className="sub">Brak importów CSV.</p> :
      <div className="tw"><table className="simple"><thead><tr><th className="l">Plik</th><th className="l">Zaimportowano</th><th className="l">Doby</th><th className="l">Metryki</th><th>Wartości</th><th>Uwagi (doby)</th><th>Odrzucone</th><th className="l">Stan</th><th /></tr></thead><tbody>
        {imports.map((item) => <tr key={item.id}><td className="l">{item.fileName}</td><td className="l">{whenOf(item.createdAt)}</td><td className="l mono">{item.first ? `${item.first} – ${item.last}` : '—'}</td><td className="l">{item.metrics.map((metric) => metricLabels[metric as CsvMetric] ?? metric).join(', ')}</td><td>{item.values}</td><td>{item.notes}</td><td>{item.rejected}</td>
          <td className="l">{item.state === 'included' ? 'w danych (uzupełnia braki)' : 'wycofany'}</td>
          <td><button type="button" className="btn ghost" disabled={busy} onClick={() => void decide(item.id, item.state === 'included' ? 'excluded' : 'included')}>{item.state === 'included' ? 'Wycofaj' : 'Przywróć'}</button></td></tr>)}
      </tbody></table></div>}
  </section>;
}
